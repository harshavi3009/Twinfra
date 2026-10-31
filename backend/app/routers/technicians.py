"""Technician ranking for GET /api/technicians/suggest (A3).

The reason string is shown verbatim in the UI, so it has to actually explain the
ordering: skill match first, then (least) current workload, then who has the
right specialty for this kind of fault.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db

router = APIRouter(prefix="/api", tags=["technicians"])

# Alert kind / equipment type -> the skill that can actually fix it.
_KIND_SKILL = {
    "night_leak": "plumbing",
    "spike": "electrical",
    "ghost_load": "electrical",
    "drift": "hvac",
    "failure_risk": "hvac",
}

# Keyword fallback for manual tickets, which arrive with prose but no evidence
# JSON. Checked against title + description, before falling back to the room's
# equipment mix (a washroom with ACs is still a plumbing job if it says "leak").
_KEYWORD_SKILL = (
    (("leak", "water", "pipe", "tap", "flush", "drain", "plumb"), "plumbing"),
    (("ac", "air condition", "hvac", "chiller", "cooling", "thermostat", "setpoint"), "hvac"),
    (("light", "lamp", "bulb", "socket", "wiring", "ups", "power", "breaker", "short"), "electrical"),
    (("motor", "pump", "bearing", "vibration", "belt"), "mechanical"),
    (("wifi", "network", "router", "server", "projector", "pc", "computer"), "it"),
)
_EQ_SKILL = {
    "ac": "hvac",
    "hvac": "hvac",
    "chiller": "hvac",
    "lighting": "electrical",
    "ups": "electrical",
    "substation": "electrical",
    "motor": "mechanical",
    "pump": "plumbing",
    "water_heater": "plumbing",
    "router": "it",
    "server": "it",
    "projector": "it",
}


class Suggestion(BaseModel):
    id: str
    name: str
    skill: str
    active_tickets: int
    reason: str


class TechnicianOut(BaseModel):
    id: str
    name: str
    skill: str
    active_tickets: int = 0


def _needed_skill(db: Session, ticket: dict) -> tuple[str | None, str]:
    """Best guess at the skill this ticket needs, plus a human reason."""
    kind = None
    evidence = ticket.get("evidence")
    if isinstance(evidence, dict):
        kind = evidence.get("kind")

    if kind and kind in _KIND_SKILL:
        return _KIND_SKILL[kind], f"{kind} fault needs {_KIND_SKILL[kind]}"

    # Manual tickets: classify from the prose before guessing from equipment.
    prose = f"{ticket.get('title') or ''} {ticket.get('description') or ''}".lower()
    for words, skill in _KEYWORD_SKILL:
        hit = next((w for w in words if w in prose), None)
        if hit:
            return skill, f"mentions '{hit}'"

    if ticket.get("equipment_id"):
        row = db.execute(
            text("SELECT eq_type FROM equipment WHERE id = :e"),
            {"e": ticket["equipment_id"]},
        ).first()
        if row and row[0] in _EQ_SKILL:
            return _EQ_SKILL[row[0]], f"{row[0]} equipment needs {_EQ_SKILL[row[0]]}"

    # Fall back to the entity's equipment mix, if it's a room/building.
    row = db.execute(
        text(
            "SELECT eq_type, count(*) AS n FROM equipment "
            "WHERE room_id = :e OR building_id = :e "
            "GROUP BY eq_type ORDER BY n DESC LIMIT 1"
        ),
        {"e": ticket.get("entity_id")},
    ).first()
    if row and row[0] in _EQ_SKILL:
        return _EQ_SKILL[row[0]], f"mostly {row[0]} equipment here"

    return None, "no specific skill needed"


@router.get("/technicians/suggest", response_model=list[Suggestion])
def suggest(
    ticket_id: str = Query(..., min_length=1), db: Session = Depends(get_db)
) -> list[Suggestion]:
    row = db.execute(
        text(
            "SELECT entity_id, equipment_id, evidence, priority, title, description "
            "FROM tickets WHERE id = :i"
        ),
        {"i": ticket_id},
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"unknown ticket {ticket_id}")

    ticket = {
        "entity_id": row[0],
        "equipment_id": row[1],
        "evidence": row[2],
        "priority": row[3],
        "title": row[4],
        "description": row[5],
    }
    needed, why = _needed_skill(db, ticket)

    techs = db.execute(
        text(
            """
            SELECT t.id, t.name, t.skill,
                   (SELECT count(*) FROM tickets k
                    WHERE k.technician_id = t.id
                      AND k.status IN ('assigned','in_progress')) AS active
            FROM technicians t
            """
        )
    ).fetchall()

    scored: list[tuple[float, Suggestion]] = []
    for tid, name, skill, active in techs:
        active = int(active)
        # Skill match dominates; each busy ticket is a small penalty, so a
        # specialist with 2 jobs still beats an idle wrong-discipline tech.
        score = 0.0
        bits: list[str] = []
        if needed and skill == needed:
            score += 10.0
            bits.append(f"matches {needed}")
        elif needed:
            score -= 4.0
            bits.append(f"{skill} not {needed}")
        score -= active * 1.5
        bits.append("idle" if active == 0 else f"{active} active")

        scored.append(
            (
                score,
                Suggestion(
                    id=tid,
                    name=name,
                    skill=skill,
                    active_tickets=active,
                    reason=", ".join(bits) + f" ({why})",
                ),
            )
        )

    # Highest score first, then lightest workload, then id for determinism.
    scored.sort(key=lambda pair: (-pair[0], pair[1].active_tickets, pair[1].id))
    return [s for _score, s in scored]


def recount(db: Session) -> None:
    """Refresh technicians.active_tickets after ticket assignment changes.

    The column is denormalised for board rendering (contract/db.md), so it is
    unnecessary to make every GET recompute it, but it must not drift.
    """
    db.execute(
        text(
            """
            UPDATE technicians t
            SET active_tickets = (
                SELECT count(*) FROM tickets k
                WHERE k.technician_id = t.id
                  AND k.status IN ('assigned','in_progress')
            )
            """
        )
    )


@router.get("/technicians", response_model=list[TechnicianOut])
def list_technicians(db: Session = Depends(get_db)) -> list[TechnicianOut]:
    # Read through the live count so the UI can never show a stale number.
    rows = db.execute(
        text(
            """
            SELECT t.id, t.name, t.skill,
                   (SELECT count(*) FROM tickets k
                    WHERE k.technician_id = t.id
                      AND k.status IN ('assigned','in_progress')) AS active_tickets
            FROM technicians t ORDER BY t.id
            """
        )
    ).fetchall()
    return [
        TechnicianOut(id=r[0], name=r[1], skill=r[2], active_tickets=int(r[3]))
        for r in rows
    ]
