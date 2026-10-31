"""D3 orchestration + D4 reports.

`run_all()` is the one entry point the simulator hits every few ticks:

    read readings -> detect anomalies -> write alerts -> raise tickets
                  -> predict failures  -> verify completed repairs

D4's `interventions()`, `sustainability()` and `asset_health()` read the same
data and answer "what should we spend money on, and what did it save".
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pandas as pd
from sqlalchemy import text

import config as C
from . import common, detect, predict, tickets as ticket_mod, verify


# ------------------------------------------------------------------ alerts


def _write_alerts(db, alerts: list[dict]) -> int:
    """Replace this run's alerts. Returns how many are newly active."""
    db.execute(text("UPDATE alerts SET active = false WHERE active = true"))

    for alert in alerts:
        db.execute(text(
            "INSERT INTO alerts (entity_id, metric, kind, actual, expected, ratio, "
            "severity, explanation, est_cost_inr_month, active, ticket_id, ts) "
            "VALUES (:entity_id, :metric, :kind, :actual, :expected, :ratio, "
            ":severity, :explanation, :est_cost_inr_month, true, :ticket_id, :ts)"
        ), {**alert, "ticket_id": alert.get("ticket_id"),
            "ts": common.now_utc()})
    db.commit()
    return len(alerts)


def _alert_counts(alerts: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for alert in alerts:
        counts[alert["entity_id"]] = counts.get(alert["entity_id"], 0) + 1
    return counts


def _write_predictions(db, rows: list[dict]) -> int:
    """Refresh the predictions table (one row per asset)."""
    import json

    db.execute(text("DELETE FROM predictions"))
    for row in rows:
        db.execute(text(
            "INSERT INTO predictions (equipment_id, risk, days_to_failure, reasons, "
            "updated_at) VALUES (:equipment_id, :risk, :days_to_failure, "
            ":reasons, :updated_at)"
        ), {**row, "reasons": json.dumps(row["reasons"]),
            "updated_at": common.now_utc()})
    db.commit()
    return len(rows)


def run_all(db) -> dict:
    """The whole D3 pipeline for one tick."""
    readings = detect.load_readings(db, hours=24 * 14)
    if readings.empty:
        return {"alerts_new": 0, "tickets_created": 0, "verified": 0,
                "skipped": "no readings yet"}

    alerts = detect.detect_all(db)

    # tickets first, so each alert row can carry its ticket_id in one write
    with_tickets = ticket_mod.raise_tickets_for(db, alerts)
    tickets_created = sum(1 for a in with_tickets if a["ticket_created"])
    ticket_by_entity = {
        a["entity_id"]: a.get("ticket_id") for a in with_tickets if a.get("ticket_id")
    }
    for alert in alerts:
        alert["ticket_id"] = ticket_by_entity.get(alert["entity_id"])

    alerts_new = _write_alerts(db, alerts)

    predictions = predict.predict_all(db, readings, _alert_counts(alerts))
    predictions_written = _write_predictions(
        db, predict.to_prediction_rows(predictions)) if not predictions.empty else 0

    verdicts = verify.verify_pending(db)
    verified = sum(1 for v in verdicts if v.get("verification") == "verified")

    return {
        "alerts_active": alerts_new,
        "tickets_created": tickets_created,
        "tickets_updated": sum(1 for a in with_tickets if not a["ticket_created"]),
        "predictions": predictions_written,
        "verified": verified,
        "failed_verification": sum(
            1 for v in verdicts if v.get("verification") == "failed"),
    }


# ------------------------------------------------------------------ alerts read


def get_alerts(db, active: bool = True) -> list[dict]:
    """Alerts with the entity's display name joined in."""
    where = "WHERE a.active = true" if active else ""
    rows = db.execute(text(
        f"SELECT a.id, a.entity_id, a.metric, a.kind, a.actual, a.expected, "
        f"       a.ratio, a.severity, a.explanation, a.est_cost_inr_month, "
        f"       a.active, a.ticket_id, a.ts, "
        f"       COALESCE(b.name, r.name, e.name, a.entity_id) AS entity_name "
        f"FROM alerts a "
        f"LEFT JOIN buildings b ON b.id = a.entity_id "
        f"LEFT JOIN rooms r ON r.id = a.entity_id "
        f"LEFT JOIN equipment e ON e.id = a.entity_id "
        f"{where} ORDER BY a.ts DESC, a.id DESC LIMIT 200"
    )).fetchall()
    return [
        {
            "id": row[0], "entity_id": row[1], "entity_name": row[13],
            "metric": row[2], "kind": row[3],
            "actual": row[4], "expected": row[5], "ratio": row[6],
            "severity": row[7], "explanation": row[8],
            "est_cost_inr_month": row[9], "active": row[10],
            "ticket_id": row[11],
            "created_at": str(row[12]) if row[12] else None,
        }
        for row in rows
    ]


def clear_alert_state(db, entity_id: str) -> None:
    """Called from router.clear_fault when a repair is completed."""
    db.execute(text(
        "UPDATE alerts SET active = false WHERE entity_id = :eid AND active = true"
    ), {"eid": entity_id})
    db.commit()


# ------------------------------------------------------------------ D4: interventions


def get_interventions(db) -> list[dict]:
    """Ranked fixes: do these first. Sorted by monthly saving.

    Each intervention is a real, quotable proposal:
      * ghost load  -> schedule the equipment off / add a timer
      * night leak  -> repair the leak
      * spike/drift -> service or replace the asset
      * LED retrofit-> the one project that pays back across many rooms
    """
    out: list[dict] = []

    alerts = get_alerts(db, active=True)
    for alert in alerts:
        if alert["kind"] == "ghost_load":
            action = "Put the equipment on a schedule or timer"
            capex = 2000
        elif alert["kind"] == "night_leak":
            action = "Repair the leak in the water line"
            capex = 4500
        elif alert["kind"] == "drift":
            action = "Service or replace the ageing equipment"
            capex = 15000
        else:
            action = "Inspect and service the asset"
            capex = 6000

        monthly = max(int(alert["est_cost_inr_month"] or 0), 0)
        out.append({
            "title": action,
            "entity_id": alert["entity_id"],
            "entity_name": alert["entity_name"],
            "kind": alert["kind"],
            "severity": alert["severity"],
            "saving_inr_month": monthly,
            "capex_inr": capex,
            "payback_months": round(capex / monthly, 1) if monthly > 0 else None,
            "co2_kg_month": round(common.kwh_to_co2(monthly / C.TARIFF_INR_PER_KWH), 1),
            "reason": alert["explanation"],
            "source": "alert",
        })

    # one campus-wide retrofit proposal, the thing every college should do
    lighting_kwh = _lighting_kwh_month(db)
    saved_kwh = lighting_kwh * 0.4
    retro_saving = int(saved_kwh * C.TARIFF_INR_PER_KWH)
    if retro_saving > 0:
        out.append({
            "title": "LED retrofit across campus lighting",
            "entity_id": "campus",
            "entity_name": "Whole campus",
            "kind": "retrofit",
            "severity": "medium",
            "saving_inr_month": retro_saving,
            "capex_inr": 240000,
            "payback_months": round(240000 / retro_saving, 1) if retro_saving else None,
            "co2_kg_month": round(common.kwh_to_co2(saved_kwh), 1),
            "reason": (
                f"Lighting draws about {lighting_kwh:,.0f} kWh/month; "
                f"LEDs typically cut that by 40%."
            ),
            "source": "project",
        })

    out.sort(key=lambda i: i["saving_inr_month"], reverse=True)
    return out


def _lighting_kwh_month(db) -> float:
    """Monthly kWh that campus lighting accounts for, from the asset register."""
    row = db.execute(text(
        "SELECT COALESCE(SUM(rated_kw), 0) FROM equipment WHERE eq_type = 'lighting'"
    )).scalar()
    rated = float(row or 0.0)
    # assume lights run 8 hours a day, and the register's rated load is
    # roughly half of what is actually installed (not every fitting listed)
    return rated * 8 * 30 * 2.0


# ------------------------------------------------------------------ D4: what-if


WHATIF_LIBRARY: dict[str, dict] = {
    "led_retrofit": {"label": "LED retrofit", "reduction": 0.40, "target": "lighting"},
    "schedule_ac": {"label": "Schedule ACs off after hours", "reduction": 0.22, "target": "ac"},
    "fix_ghost_load": {"label": "Eliminate ghost loads", "reduction": 0.90, "target": "ghost"},
    "solar_roof": {"label": "Rooftop solar", "reduction": 0.15, "target": "power"},
}


def whatif(db, action: str, entity_id: str | None = None) -> dict:
    """'If we did X, what would change?' — answers for the 3D map to recolour."""
    spec = WHATIF_LIBRARY.get(action)
    if spec is None:
        raise ValueError(
            f"unknown action '{action}'; try one of {sorted(WHATIF_LIBRARY)}")

    base = sustainability(db, days=30)
    extra_kwh = _ghost_kwh_month(db) if spec["target"] == "ghost" else 0.0
    if spec["target"] == "lighting":
        extra_kwh = _lighting_kwh_month(db)

    base_kwh = float(base["kwh"] or 0.0) + extra_kwh
    saved_kwh = base_kwh * spec["reduction"]

    by_building = {}
    for row in base["by_building"]:
        share = spec["reduction"]
        by_building[row["building_id"]] = round(
            float(row["kwh"]) * (1 - share), 1)

    return {
        "action": action,
        "label": spec["label"],
        "entity_id": entity_id or "campus",
        "baseline": {
            "kwh": round(base_kwh, 1),
            "cost_inr": int(base_kwh * C.TARIFF_INR_PER_KWH),
            "co2_kg": round(common.kwh_to_co2(base_kwh), 1),
        },
        "projected": {
            "kwh": round(base_kwh - saved_kwh, 1),
            "cost_inr": int((base_kwh - saved_kwh) * C.TARIFF_INR_PER_KWH),
            "co2_kg": round(common.kwh_to_co2(base_kwh - saved_kwh), 1),
        },
        "saving": {
            "kwh_month": round(saved_kwh, 1),
            "inr_month": int(saved_kwh * C.TARIFF_INR_PER_KWH),
            "co2_kg_month": round(common.kwh_to_co2(saved_kwh), 1),
            "pct": round(spec["reduction"] * 100, 1),
        },
        "by_building": by_building,
    }


def _ghost_kwh_month(db) -> float:
    """Total kWh/month currently wasted on ghost loads."""
    rows = db.execute(text(
        "SELECT actual - expected FROM alerts "
        "WHERE active = true AND kind = 'ghost_load'"
    )).fetchall()
    kw = sum(max(float(r[0] or 0.0), 0.0) for r in rows)
    return kw * 8 * 30


# ------------------------------------------------------------------ D4: reports


def sustainability(db, days: int = 30) -> dict:
    """Campus energy / water / carbon for the last `days`, vs the period before."""
    end = common.now_utc()
    start = end - timedelta(days=days)
    prev_start = start - timedelta(days=days)

    rows = db.execute(text(
        "SELECT entity_id, metric, value, ts FROM readings "
        "WHERE ts >= :since AND metric IN ('power_kw','water_lpm')"
    ), {"since": prev_start}).fetchall()
    if not rows:
        return {"kwh": 0.0, "water_kl": 0.0, "co2_kg": 0.0, "cost_inr": 0,
                "vs_prev_pct": 0.0, "score": 0, "trees_equiv": 0.0,
                "by_building": []}

    df = pd.DataFrame(rows, columns=["entity_id", "metric", "value", "ts"])
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df["building_id"] = df["entity_id"].str.extract(r"^(B\d+)")

    power = df[df["metric"] == "power_kw"]
    water = df[df["metric"] == "water_lpm"]

    # buildings only, so rooms are not double counted with their parents
    top = power[power["entity_id"].str.fullmatch(r"B\d+")]
    this = top[(top["ts"] >= pd.Timestamp(start)) & (top["ts"] <= pd.Timestamp(end))]
    prev = top[(top["ts"] >= pd.Timestamp(prev_start)) & (top["ts"] < pd.Timestamp(start))]

    kwh = float(this["value"].sum())            # hourly readings = kWh each
    prev_kwh = float(prev["value"].sum())

    # water is metered per building (water_lpm) — nothing is recorded at UT-TANK
    water_top = water[water["entity_id"].str.fullmatch(r"B\d+")]
    water_sum = float(water_top[
        (water_top["ts"] >= pd.Timestamp(start)) &
        (water_top["ts"] <= pd.Timestamp(end))]["value"].sum())
    water_kl = water_sum * 0.06                 # l/min over an hour -> kL

    co2 = common.kwh_to_co2(kwh)
    vs_prev = ((kwh - prev_kwh) / prev_kwh * 100) if prev_kwh > 0 else 0.0

    # 0..100 score against an energy-intensity yardstick. A campus around
    # 1.0 kWh per seat per day scores ~75; it hits 100 at 0.4 and 0 at 2.0.
    capacity = float(db.execute(text(
        "SELECT COALESCE(SUM(capacity), 0) FROM rooms")).scalar() or 1.0)
    kwh_per_seat_day = kwh / max(capacity, 1.0) / max(days, 1)
    score = 100 - ((kwh_per_seat_day - 0.4) / 1.6) * 100
    score = int(max(0, min(100, round(score))))

    by_building = []
    for building_id, group in this.groupby("building_id"):
        if building_id is None or pd.isna(building_id):
            continue
        b_kwh = float(group["value"].sum())
        by_building.append({
            "building_id": str(building_id),
            "kwh": round(b_kwh, 1),
            "cost_inr": int(b_kwh * C.TARIFF_INR_PER_KWH),
            "co2_kg": round(common.kwh_to_co2(b_kwh), 1),
        })

    return {
        "kwh": round(kwh, 1),
        "water_kl": round(water_kl, 2),
        "co2_kg": round(co2, 1),
        "cost_inr": int(kwh * C.TARIFF_INR_PER_KWH),
        "vs_prev_pct": round(vs_prev, 1),
        "score": score,
        "trees_equiv": round(co2 / C.CO2_KG_PER_TREE_PER_YEAR, 1),
        "by_building": sorted(by_building, key=lambda b: b["kwh"], reverse=True),
    }


def asset_health(db) -> dict:
    """Per-building health plus the assets most likely to fail next."""
    buildings = db.execute(text("SELECT id, name FROM buildings")).fetchall()

    out = []
    for building_id, name in buildings:
        total = db.execute(text(
            "SELECT COUNT(*) FROM equipment WHERE building_id = :b"
        ), {"b": building_id}).scalar() or 0
        bad = db.execute(text(
            "SELECT COUNT(*) FROM equipment WHERE building_id = :b "
            "AND status IN ('fault','maintenance')"
        ), {"b": building_id}).scalar() or 0
        alerts_open = db.execute(text(
            "SELECT COUNT(*) FROM alerts a JOIN equipment e ON e.id = a.entity_id "
            "WHERE e.building_id = :b AND a.active = true"
        ), {"b": building_id}).scalar() or 0
        high_risk = db.execute(text(
            "SELECT COUNT(*) FROM predictions p JOIN equipment e ON e.id = p.equipment_id "
            "WHERE e.building_id = :b AND p.risk >= 0.7"
        ), {"b": building_id}).scalar() or 0

        penalty = (bad * 6) + (alerts_open * 4) + (high_risk * 3)
        out.append({
            "building_id": building_id,
            "building_name": name,
            "assets": int(total),
            "faulty_assets": int(bad),
            "open_alerts": int(alerts_open),
            "high_risk_assets": int(high_risk),
            "health_score": int(max(0, min(100, 100 - penalty))),
        })

    worst = db.execute(text(
        "SELECT p.equipment_id, e.name, e.room_id, e.criticality, "
        "       p.risk, p.days_to_failure, p.reasons, e.replacement_cost "
        "FROM predictions p JOIN equipment e ON e.id = p.equipment_id "
        "ORDER BY p.risk DESC LIMIT 20"
    )).fetchall()

    return {
        "buildings": sorted(out, key=lambda b: b["health_score"]),
        "worst_assets": [
            {
                "equipment_id": row[0], "name": row[1], "room_id": row[2],
                "criticality": row[3], "risk": round(float(row[4]), 3),
                "days_to_failure": row[5],
                "reasons": row[6] if isinstance(row[6], list) else [],
                "replacement_cost_inr": row[7],
            }
            for row in worst
        ],
    }
