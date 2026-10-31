"""Core read APIs (A2): campus -> building -> floor -> room -> equipment.

api.md shapes exactly. Live values (power_kw/water_lpm/occupancy) come from the
most recent reading per entity+metric; baselines from readings.baseline, and
fall back to the trailing 24 h mean when baseline is null so the UI never shows
a dead baseline bar.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import schemas
from ..constants import STATUS_CRITICAL, STATUS_OFFLINE, STATUS_OK, STATUS_WARNING
from ..db import get_db
from ..status import active_alert_status, equipment_status, risk_status, worse

router = APIRouter(prefix="/api", tags=["core"])


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _metric_map(db: Session, ids: list[str]) -> dict[str, dict[str, float]]:
    """Newest value + stored baseline per entity/metric, in ONE round trip.

    Also returns the trailing-24h mean as `<metric>_fallback` so callers never
    need a second scan of readings just for a baseline. Each round trip to a
    remote Postgres costs ~300 ms, so query count is the thing that matters.
    """
    if not ids:
        return {}
    rows = db.execute(
        text(
            """
            WITH latest AS (
                SELECT DISTINCT ON (entity_id, metric)
                       entity_id, metric, value, baseline
                FROM readings
                WHERE entity_id = ANY(:ids)
                ORDER BY entity_id, metric, ts DESC
            ), recent AS (
                SELECT entity_id, metric, avg(value) AS mean
                FROM readings
                WHERE entity_id = ANY(:ids) AND ts >= :since
                GROUP BY entity_id, metric
            )
            SELECT l.entity_id, l.metric, l.value, l.baseline, r.mean
            FROM latest l LEFT JOIN recent r USING (entity_id, metric)
            """
        ),
        {
            "ids": ids,
            "since": datetime.now(timezone.utc) - timedelta(hours=24),
        },
    ).fetchall()

    out: dict[str, dict[str, float]] = {}
    for entity_id, metric, value, baseline, mean in rows:
        m = out.setdefault(entity_id, {})
        m[metric] = float(value)
        if baseline is not None:
            m[f"{metric}_baseline"] = float(baseline)
        elif mean is not None:
            m[f"{metric}_baseline"] = float(mean)
    return out


def _power(db: Session, entity_id: str, hours: int = 24) -> tuple[float, float]:
    """Live power_kw for a room/equipment: newest reading, else 0."""
    row = db.execute(
        text(
            "SELECT value FROM readings WHERE entity_id = :e AND metric = 'power_kw' "
            "ORDER BY ts DESC LIMIT 1"
        ),
        {"e": entity_id},
    ).first()
    return (float(row[0]) if row else 0.0, 0.0)


def _baseline(
    db: Session, entity_id: str, metric: str, hours: int = 24
) -> float | None:
    """Per-point baseline storage first, then a 24 h mean, then None.

    Single-entity path. Use _baselines() for any loop: against a remote
    Postgres one round trip is ~0.5 s, so 88 of these is a 40 s request.
    """
    return _baselines(db, [entity_id], metric, hours=hours).get(entity_id)


def _baselines(
    db: Session, ids: list[str], metric: str, hours: int = 24
) -> dict[str, float]:
    """Batched baseline for many entities in ONE round trip.

    Stored readings.baseline wins; absent that, the trailing mean. Entities with
    neither are simply missing from the result, so callers use .get(id) or 0.
    """
    if not ids:
        return {}
    rows = db.execute(
        text(
            """
            WITH stored AS (
                SELECT DISTINCT ON (entity_id) entity_id, baseline
                FROM readings
                WHERE entity_id = ANY(:ids) AND metric = :m AND baseline IS NOT NULL
                ORDER BY entity_id, ts DESC
            ), recent AS (
                SELECT entity_id, avg(value) AS mean
                FROM readings
                WHERE entity_id = ANY(:ids) AND metric = :m AND ts >= :since
                GROUP BY entity_id
            )
            SELECT t.entity_id, COALESCE(s.baseline, t.mean)
            FROM recent t LEFT JOIN stored s USING (entity_id)
            """
        ),
        {
            "ids": ids,
            "m": metric,
            "since": datetime.now(timezone.utc) - timedelta(hours=hours),
        },
    ).fetchall()
    return {r[0]: float(r[1]) for r in rows if r[1] is not None}


def _open_ticket_count(db: Session) -> int:
    return int(
        db.execute(
            text("SELECT count(*) FROM tickets WHERE status IN ('open','assigned','in_progress')")
        ).scalar_one()
    )


def _alert_state(db: Session) -> tuple[dict[str, str], dict[str, int]]:
    """Per-entity worst active severity + active-alert count, in ONE query."""
    rows = db.execute(
        text(
            """
            SELECT entity_id, count(*) AS n,
                   bool_or(severity IN ('critical','high')) AS is_bad
            FROM alerts WHERE active IS TRUE GROUP BY entity_id
            """
        )
    ).fetchall()
    status: dict[str, str] = {}
    counts: dict[str, int] = {}
    for entity_id, n, is_bad in rows:
        status[entity_id] = STATUS_CRITICAL if is_bad else STATUS_WARNING
        counts[entity_id] = int(n)
    return status, counts


# --------------------------------------------------------------------------- #
# GET /api/campus
# --------------------------------------------------------------------------- #
@router.get("/campus", response_model=schemas.Campus)
def get_campus(db: Session = Depends(get_db)) -> schemas.Campus:
    buildings = db.execute(
        text(
            "SELECT id, name, floors, pos_x, pos_z, width, depth FROM buildings ORDER BY id"
        )
    ).fetchall()

    bids = [b[0] for b in buildings]
    metrics = _metric_map(db, bids)
    alerts, alert_counts = _alert_state(db)

    # active alert *count* per entity (the card shows a number, not a colour)
    cards: list[schemas.BuildingCard] = []
    for bid, name, nfloors, px, pz, w, d in buildings:
        m = metrics.get(bid, {})
        power = m.get("power_kw", 0.0)
        baseline = m.get("power_kw_baseline") or 0.0
        cards.append(
            schemas.BuildingCard(
                id=bid,
                name=name,
                floors=int(nfloors),
                position=schemas.Position(x=float(px), z=float(pz)),
                size=schemas.Size(w=float(w), d=float(d)),
                status=alerts.get(bid, STATUS_OK),
                power_kw=round(power, 2),
                baseline_kw=round(float(baseline), 2),
                water_lpm=round(m.get("water_lpm", 0.0), 2),
                occupancy=int(m.get("occupancy", 0) or 0),
                active_alerts=alert_counts.get(bid, 0),
            )
        )

    utilities = [
        schemas.UtilityNode(
            id="UT-SUB", type="substation", position=schemas.Position(x=-50, z=0)
        ),
        schemas.UtilityNode(
            id="UT-TANK", type="water tank", position=schemas.Position(x=50, z=0)
        ),
    ]

    return schemas.Campus(
        buildings=cards,
        utilities=utilities,
        totals=schemas.CampusTotals(
            power_kw=round(sum(c.power_kw for c in cards), 2),
            baseline_kw=round(sum(c.baseline_kw for c in cards), 2),
            water_lpm=round(sum(c.water_lpm for c in cards), 2),
            occupancy=sum(c.occupancy for c in cards),
            active_alerts=sum(c.active_alerts for c in cards),
            open_tickets=_open_ticket_count(db),
        ),
    )


# --------------------------------------------------------------------------- #
# GET /api/buildings/{id}
# --------------------------------------------------------------------------- #
@router.get("/buildings/{building_id}", response_model=schemas.BuildingDetail)
def get_building(building_id: str, db: Session = Depends(get_db)) -> schemas.BuildingDetail:
    b = db.execute(
        text("SELECT id, name FROM buildings WHERE id = :b"), {"b": building_id}
    ).first()
    if not b:
        raise HTTPException(status_code=404, detail=f"unknown building {building_id}")

    floors = db.execute(
        text("SELECT id, level FROM floors WHERE building_id = :b ORDER BY level"),
        {"b": building_id},
    ).fetchall()

    rooms = db.execute(
        text(
            """
            SELECT r.id, r.name, r.room_type, r.floor_id,
                   (SELECT count(*) FROM equipment e WHERE e.room_id = r.id) AS eq_count
            FROM rooms r WHERE r.building_id = :b ORDER BY r.id
            """
        ),
        {"b": building_id},
    ).fetchall()

    rids = [r[0] for r in rooms]
    alerts = active_alert_status(db)
    metrics = _metric_map(db, rids)

    by_floor: dict[str, list[schemas.RoomSummary]] = {}
    for rid, name, rtype, fid, eq_count in rooms:
        m = metrics.get(rid, {})
        baseline = m.get("power_kw_baseline") or 0.0
        by_floor.setdefault(fid, []).append(
            schemas.RoomSummary(
                id=rid,
                name=name,
                room_type=rtype,
                status=alerts.get(rid, STATUS_OK),
                power_kw=round(m.get("power_kw", 0.0), 2),
                baseline_kw=round(float(baseline), 2),
                occupancy=int(m.get("occupancy", 0) or 0),
                equipment_count=int(eq_count),
            )
        )

    return schemas.BuildingDetail(
        id=b[0],
        name=b[1],
        floors=[
            schemas.FloorDetail(
                id=fid, level=int(level), rooms=by_floor.get(fid, [])
            )
            for fid, level in floors
        ],
    )


# --------------------------------------------------------------------------- #
# GET /api/rooms/{id}
# --------------------------------------------------------------------------- #
@router.get("/rooms/{room_id}", response_model=schemas.RoomDetail)
def get_room(room_id: str, db: Session = Depends(get_db)) -> schemas.RoomDetail:
    room = db.execute(
        text("SELECT id, name, room_type FROM rooms WHERE id = :r"), {"r": room_id}
    ).first()
    if not room:
        raise HTTPException(status_code=404, detail=f"unknown room {room_id}")

    eqs = db.execute(
        text(
            "SELECT id, name, eq_type, criticality, status FROM equipment "
            "WHERE room_id = :r ORDER BY id"
        ),
        {"r": room_id},
    ).fetchall()

    eids = [e[0] for e in eqs]
    alerts = active_alert_status(db)
    risky = risk_status(db)
    metrics = _metric_map(db, eids)

    equipment: list[schemas.EquipmentSummary] = []
    worst = alerts.get(room_id, STATUS_OK)
    for eid, ename, etype, crit, status in eqs:
        health = equipment_status(status)
        health = worse(health, alerts.get(eid, STATUS_OK))
        health = worse(health, risky.get(eid, STATUS_OK))
        worst = worse(worst, health)
        equipment.append(
            schemas.EquipmentSummary(
                id=eid,
                name=ename,
                eq_type=etype,
                status=health,
                criticality=crit,
                power_kw=round(metrics.get(eid, {}).get("power_kw", 0.0), 2),
                health=health,
            )
        )

    return schemas.RoomDetail(
        id=room[0],
        name=room[1],
        room_type=room[2],
        status=worse(worst, alerts.get(room_id, STATUS_OK)),
        equipment=equipment,
    )


# --------------------------------------------------------------------------- #
# GET /api/equipment/{id}
# --------------------------------------------------------------------------- #
@router.get("/equipment/{equipment_id}", response_model=schemas.EquipmentDetail)
def get_equipment(
    equipment_id: str, db: Session = Depends(get_db)
) -> schemas.EquipmentDetail:
    eq = db.execute(
        text(
            "SELECT id, name, eq_type, room_id, building_id, rated_kw, replacement_cost, "
            "       status, criticality, owner_dept, owner_name, install_date, "
            "       warranty_until, status "
            "FROM equipment WHERE id = :e"
        ),
        {"e": equipment_id},
    ).first()
    if not eq:
        raise HTTPException(status_code=404, detail=f"unknown equipment {equipment_id}")

    (
        eid, name, eq_type, room_id, building_id, rated_kw, replacement_cost,
        _status_dup, criticality, owner_dept, owner_name, install_date,
        warranty_until, status,
    ) = eq

    history = [
        schemas.HistoryEntry(
            date=r[0].isoformat() if isinstance(r[0], date) else str(r[0]),
            action=r[1],
            cost=int(r[2] or 0),
            notes=r[3],
        )
        for r in db.execute(
            text(
                "SELECT date, action, cost, notes FROM maintenance_log "
                "WHERE equipment_id = :e ORDER BY date DESC LIMIT 20"
            ),
            {"e": equipment_id},
        ).fetchall()
    ]

    pred_row = db.execute(
        text(
            "SELECT risk, days_to_failure, reasons FROM predictions "
            "WHERE equipment_id = :e"
        ),
        {"e": equipment_id},
    ).first()
    prediction = (
        schemas.PredictionInfo(
            risk=float(pred_row[0]),
            days_to_failure=pred_row[1],
            reasons=list(pred_row[2] or []),
        )
        if pred_row
        else None
    )

    power, _ = _power(db, equipment_id)

    open_ticket = db.execute(
        text(
            "SELECT id FROM tickets WHERE equipment_id = :e "
            "AND status IN ('open','assigned','in_progress') ORDER BY created_at LIMIT 1"
        ),
        {"e": equipment_id},
    ).first()

    warranty_days_left = None
    if warranty_until:
        wd = warranty_until if isinstance(warranty_until, date) else date.fromisoformat(str(warranty_until))
        warranty_days_left = (wd - date.today()).days

    return schemas.EquipmentDetail(
        id=eid,
        name=name,
        eq_type=eq_type,
        room_id=room_id,
        building_id=building_id,
        rated_kw=float(rated_kw or 0.0),
        power_kw=round(power, 2),
        status=status,
        criticality=criticality,
        owner_dept=owner_dept,
        owner_name=owner_name,
        install_date=install_date.isoformat() if hasattr(install_date, "isoformat") else install_date,
        warranty_until=warranty_until.isoformat() if hasattr(warranty_until, "isoformat") else warranty_until,
        warranty_days_left=warranty_days_left,
        replacement_cost=int(replacement_cost or 0),
        history=history,
        prediction=prediction,
        open_ticket_id=open_ticket[0] if open_ticket else None,
    )
