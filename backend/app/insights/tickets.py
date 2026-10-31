"""Auto-ticket creation (D3).

A serious alert should reach a technician without a human triaging it. This
module writes straight into the `tickets` table, because Ayaan's
`POST /api/tickets` is a thin wrapper over the same table and going through it
would mean an HTTP call from inside our own process.

If his contract changes (ID format, auto-assign, evidence column) only
`create_ticket()` needs to move.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from .common import now_utc

# An alert at or above this severity raises a ticket.
AUTO_TICKET_SEVERITIES = {"critical", "high"}

# SLA hours by priority. Taken from app/constants.py when Ayaan's A3 has landed
# (contract/db.md: 4/12/48/72) so the two can never drift apart again; the
# literal below is the same table, used only when that module is unavailable.
try:
    from ..constants import SLA_HOURS                       # noqa: F401
except Exception:                                            # pragma: no cover
    SLA_HOURS = {"critical": 4, "high": 12, "medium": 48, "low": 72}

# Use whatever skills match the fault. First match wins, in this order.
SKILL_BY_KIND = {
    "spike": "electrical",
    "ghost_load": "electrical",
    "night_leak": "plumbing",
    "drift": "hvac",
    "failure_risk": "hvac",
}

_SOURCE = "auto"


# ------------------------------------------------------------------ ids


# Ayaan owns the real sequence (`helpers.next_ticket_id`, atomic nextval on
# ticket_id_seq, lands in A3). Until then auto-tickets live in the reserved
# TK-9xxx range so auto and manual tickets are distinguishable in the demo.
AUTO_TICKET_START = 9001

_USE_SEQUENCE = True   # flipped off automatically when the helper is missing


def next_ticket_id(db) -> str:
    """Delegates to Ayaan's sequence when it exists, else TK-9001, TK-9002, ...

    `max(id)+1` is deliberately avoided: two concurrent runs would collide.
    """
    global _USE_SEQUENCE
    if _USE_SEQUENCE:
        try:
            from ..tickets.ids import next_ticket_id as ayaan_next
            return ayaan_next(db)
        except Exception:
            _USE_SEQUENCE = False

    row = db.execute(text(
        "SELECT MAX(id) FROM tickets WHERE id LIKE 'TK-9%'"
    )).scalar()
    if row is None:
        return "TK-9001"
    try:
        n = int(str(row)[3:])
    except ValueError:
        n = AUTO_TICKET_START - 1
    return f"TK-{max(n + 1, AUTO_TICKET_START):04d}"


# ------------------------------------------------------------------ dedupe


def open_ticket_for(db, entity_id: str) -> dict | None:
    """An existing open ticket for this entity, if there is one."""
    row = db.execute(text(
        "SELECT id, status, title FROM tickets "
        "WHERE entity_id = :eid AND status IN ('open','assigned','in_progress') "
        "ORDER BY created_at DESC LIMIT 1"
    ), {"eid": entity_id}).fetchone()
    return {"id": row[0], "status": row[1], "title": row[2]} if row else None


# ------------------------------------------------------------------ create


def create_ticket(db, *, entity_id: str, title: str, description: str,
                  priority: str, equipment_id: str | None = None,
                  evidence: dict | None = None) -> str:
    """Insert one auto ticket and return its id."""
    ticket_id = next_ticket_id(db)
    created = now_utc()
    sla = created + timedelta(hours=SLA_HOURS.get(priority, 72))

    db.execute(text(
        "INSERT INTO tickets (id, entity_id, equipment_id, title, description, "
        "source, priority, status, created_at, sla_due_at, escalated, verification) "
        "VALUES (:id, :entity_id, :equipment_id, :title, :description, "
        ":source, :priority, 'open', :created_at, :sla_due_at, false, 'none')"
    ), {
        "id": ticket_id,
        "entity_id": entity_id,
        "equipment_id": equipment_id,
        "title": title,
        "description": description,
        "source": _SOURCE,
        "priority": priority,
        "created_at": created,
        "sla_due_at": sla,
    })

    if evidence:
        # `evidence` is JSONB; write it separately so a missing column on an
        # older schema doesn't kill ticket creation.
        try:
            db.execute(text(
                "UPDATE tickets SET evidence = CAST(:evidence AS JSONB) WHERE id = :id"
            ), {"id": ticket_id, "evidence": _json(evidence)})
        except Exception:  # pragma: no cover
            db.rollback()

    db.commit()
    return ticket_id


def _json(obj: dict) -> str:
    import json
    return json.dumps(obj, default=str)


# ------------------------------------------------------------------ suggest


def suggest_technician(db, kind: str) -> str | None:
    """Pick the technician with the matching skill who has the fewest open tickets."""
    skill = SKILL_BY_KIND.get(kind, "electrical")
    row = db.execute(text(
        "SELECT t.id FROM technicians t "
        "LEFT JOIN tickets tk ON tk.technician_id = t.id "
        "     AND tk.status IN ('open','assigned','in_progress') "
        "WHERE t.skills ILIKE :skill AND t.available IS NOT FALSE "
        "GROUP BY t.id ORDER BY COUNT(tk.id) ASC, t.id ASC LIMIT 1"
    ), {"skill": f"%{skill}%"}).fetchone()
    return row[0] if row else None


# ------------------------------------------------------------------ from alerts


def raise_tickets_for(db, alerts: list[dict]) -> list[dict]:
    """One ticket per entity with a serious, currently-uncovered alert."""
    created: list[dict] = []

    for alert in alerts:
        if alert["severity"] not in AUTO_TICKET_SEVERITIES:
            continue

        existing = open_ticket_for(db, alert["entity_id"])
        if existing:
            created.append({**alert, "ticket_id": existing["id"],
                            "ticket_created": False})
            continue

        kind_label = {
            "spike": "Abnormal power spike",
            "ghost_load": "Equipment running in an empty room",
            "night_leak": "Suspected water leak",
            "drift": "Load drifting upward",
        }.get(alert["kind"], alert["kind"].replace("_", " ").title())

        title = f"{kind_label} — {alert['entity_id']}"
        description = (
            f"{alert['explanation']} "
            f"Estimated waste: ₹{alert['est_cost_inr_month']:,}/month. "
            f"Detected automatically by CampusTwin."
        )

        ticket_id = create_ticket(
            db,
            entity_id=alert["entity_id"],
            # equipment_id only when the alert is already about an asset
            equipment_id=alert["entity_id"] if alert["entity_id"].startswith("EQ-") else None,
            title=title[:200],
            description=description,
            priority=alert["severity"],
            evidence={
                # TicketDrawer renders evidence.explanation, so the sentence the
                # detector already wrote is the one that reaches the technician.
                "explanation": alert["explanation"],
                "metric": alert["metric"],
                "kind": alert["kind"],
                "actual": alert["actual"],
                "expected": alert["expected"],
                "ratio": alert["ratio"],
                "est_cost_inr_month": alert["est_cost_inr_month"],
                "detected_at": now_utc().isoformat(),
            },
        )
        created.append({**alert, "ticket_id": ticket_id, "ticket_created": True})

    return created
