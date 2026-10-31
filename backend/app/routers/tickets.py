"""Tickets & technicians (A3).

Contract: docs/contract/api.md ("Tickets & technicians").

  GET   /api/tickets?status=open          -> [Ticket]
  POST  /api/tickets                      -> Ticket
  PATCH /api/tickets/{id}                 -> Ticket
  POST  /api/tickets/{id}/complete        -> Ticket (multipart photo optional)
  GET   /api/technicians                  -> [{id,name,skill,active_tickets}]
  GET   /api/technicians/suggest?ticket_id -> ranked, best first

Ticket FSM (contract/db.md):
  open -> assigned -> in_progress -> done -> closed
  done sets verification='pending'; Aditya's verifier moves it to
  verified/failed. Nothing here jumps to closed on its own.

This is the demo spine (alert -> ticket -> verified fix), so ticket writes are
transactional and every transition is validated against the allowed edges.
"""

from __future__ import annotations

import shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..constants import PRIORITIES, SLA_HOURS, TICKET_STATUSES
from ..db import get_db
from ..tickets.ids import next_ticket_id
from . import technicians as tech_mod

router = APIRouter(prefix="/api", tags=["tickets"])

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"

# Legal FSM edges (contract/db.md): open -> assigned -> in_progress -> done -> closed.
# Reopen is only from 'done' (a failed verification), never from a working state -
# otherwise a ticket can silently slide backwards and lose its audit trail.
_ALLOWED = {
    "open": {"assigned", "in_progress", "done", "closed"},
    "assigned": {"in_progress", "done", "closed"},
    "in_progress": {"done", "closed"},
    "done": {"closed", "open"},
    "closed": set(),
}

_TICKET_COLS = """
    t.id, t.entity_id, t.equipment_id, t.title, t.description, t.source,
    t.priority, t.status, t.technician_id, t.created_at, t.sla_due_at,
    t.escalated, t.completed_at, t.completion_photo, t.completion_note,
    t.verification, t.evidence, tech.name AS technician_name
"""


# --------------------------------------------------------------------------- #
# schemas
# --------------------------------------------------------------------------- #
class TechnicianRef(BaseModel):
    id: str
    name: str


class TicketOut(BaseModel):
    id: str
    entity_id: str
    equipment_id: str | None = None
    title: str
    description: str | None = None
    source: str
    priority: str
    status: str
    technician: TechnicianRef | None = None
    created_at: datetime
    sla_due_at: datetime | None = None
    sla_seconds_left: int | None = None
    escalated: bool = False
    verification: str = "none"
    evidence: dict | None = None
    completed_at: datetime | None = None
    completion_photo: str | None = None
    completion_note: str | None = None


class TicketCreate(BaseModel):
    entity_id: str = Field(..., min_length=1)
    equipment_id: str | None = None
    title: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    priority: str = "medium"
    # Aditya's detection loop posts source='auto' + the alert as evidence.
    source: str = "manual"
    evidence: dict | None = None


class TicketPatch(BaseModel):
    status: str | None = None
    technician_id: str | None = None
    priority: str | None = None


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _row_to_ticket(row) -> TicketOut:
    (
        tid, entity_id, equipment_id, title, description, source, priority,
        status, technician_id, created_at, sla_due_at, escalated, completed_at,
        completion_photo, completion_note, verification, evidence, tech_name,
    ) = row

    seconds_left = None
    if sla_due_at is not None:
        due = sla_due_at if sla_due_at.tzinfo else sla_due_at.replace(tzinfo=timezone.utc)
        seconds_left = int((due - datetime.now(timezone.utc)).total_seconds())

    return TicketOut(
        id=tid,
        entity_id=entity_id,
        equipment_id=equipment_id,
        title=title,
        description=description,
        source=source,
        priority=priority,
        status=status,
        technician=(
            TechnicianRef(id=technician_id, name=tech_name or technician_id)
            if technician_id
            else None
        ),
        created_at=created_at,
        sla_due_at=sla_due_at,
        sla_seconds_left=seconds_left,
        escalated=bool(escalated),
        verification=verification,
        evidence=evidence,
        completed_at=completed_at,
        completion_photo=completion_photo,
        completion_note=completion_note,
    )


def _fetch(db: Session, ticket_id: str) -> TicketOut:
    row = db.execute(
        text(
            f"SELECT {_TICKET_COLS} FROM tickets t "
            "LEFT JOIN technicians tech ON tech.id = t.technician_id "
            "WHERE t.id = :id"
        ),
        {"id": ticket_id},
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"unknown ticket {ticket_id}")
    return _row_to_ticket(row)


# --------------------------------------------------------------------------- #
# GET /api/tickets
# --------------------------------------------------------------------------- #
@router.get("/tickets", response_model=list[TicketOut])
def list_tickets(
    status: str | None = Query(None),
    entity_id: str | None = Query(None),
    technician_id: str | None = Query(None),
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
) -> list[TicketOut]:
    sql = (
        f"SELECT {_TICKET_COLS} FROM tickets t "
        "LEFT JOIN technicians tech ON tech.id = t.technician_id WHERE TRUE"
    )
    params: dict = {"limit": limit}
    if status:
        if status not in TICKET_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"unknown status {status!r}; expected one of {list(TICKET_STATUSES)}",
            )
        sql += " AND t.status = :status"
        params["status"] = status
    if entity_id:
        sql += " AND t.entity_id = :entity_id"
        params["entity_id"] = entity_id
    if technician_id:
        sql += " AND t.technician_id = :technician_id"
        params["technician_id"] = technician_id

    # Worst first so the board's top row matters: critical, then most overdue.
    sql += (
        " ORDER BY CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1"
        " WHEN 'medium' THEN 2 ELSE 3 END, t.sla_due_at NULLS LAST LIMIT :limit"
    )

    rows = db.execute(text(sql), params).fetchall()
    return [_row_to_ticket(r) for r in rows]


# --------------------------------------------------------------------------- #
# POST /api/tickets
# --------------------------------------------------------------------------- #
@router.post("/tickets", response_model=TicketOut, status_code=201)
def create_ticket(payload: TicketCreate, db: Session = Depends(get_db)) -> TicketOut:
    if payload.priority not in PRIORITIES:
        raise HTTPException(
            status_code=400,
            detail=f"unknown priority {payload.priority!r}; expected one of {list(PRIORITIES)}",
        )
    if payload.source not in ("auto", "manual"):
        raise HTTPException(status_code=400, detail="source must be 'auto' or 'manual'")

    # entity_id must be real, or the frontend's 3D highlight silently no-ops.
    known = db.execute(
        text(
            "SELECT 1 FROM buildings WHERE id = :e UNION ALL "
            "SELECT 1 FROM rooms WHERE id = :e UNION ALL "
            "SELECT 1 FROM equipment WHERE id = :e UNION ALL "
            "SELECT 1 WHERE :e IN ('UT-SUB','UT-TANK') LIMIT 1"
        ),
        {"e": payload.entity_id},
    ).first()
    if not known:
        raise HTTPException(
            status_code=400, detail=f"unknown entity_id {payload.entity_id!r}"
        )
    if payload.equipment_id:
        eq = db.execute(
            text("SELECT 1 FROM equipment WHERE id = :e"), {"e": payload.equipment_id}
        ).first()
        if not eq:
            raise HTTPException(
                status_code=400, detail=f"unknown equipment_id {payload.equipment_id!r}"
            )

    ticket_id = next_ticket_id(db, auto=(payload.source == "auto"))
    now = datetime.now(timezone.utc)
    due = now + timedelta(hours=SLA_HOURS[payload.priority])

    # No technician on create: a human (or /suggest) assigns. Aditya's
    # auto-tickets land here too, so the board shows unassigned work.
    db.execute(
        text(
            """
            INSERT INTO tickets (id, entity_id, equipment_id, title, description,
                                 source, priority, status, technician_id, created_at,
                                 sla_due_at, escalated, verification, evidence)
            VALUES (:id, :entity_id, :equipment_id, :title, :description,
                    :source, :priority, 'open', NULL, :created_at,
                    :sla_due_at, false, 'none', CAST(:evidence AS JSONB))
            """
        ),
        {
            "id": ticket_id,
            "entity_id": payload.entity_id,
            "equipment_id": payload.equipment_id,
            "title": payload.title,
            "description": payload.description,
            "source": payload.source,
            "priority": payload.priority,
            "created_at": now,
            "sla_due_at": due,
            "evidence": _json(payload.evidence),
        },
    )
    db.commit()
    return _fetch(db, ticket_id)


def _json(obj: dict | None) -> str | None:
    if obj is None:
        return None
    import json

    return json.dumps(obj, default=str)


# --------------------------------------------------------------------------- #
# PATCH /api/tickets/{id}
# --------------------------------------------------------------------------- #
@router.patch("/tickets/{ticket_id}", response_model=TicketOut)
def patch_ticket(
    ticket_id: str, payload: TicketPatch, db: Session = Depends(get_db)
) -> TicketOut:
    cur = db.execute(
        text(
            "SELECT status, priority, technician_id, sla_due_at, created_at, entity_id "
            "FROM tickets WHERE id = :id"
        ),
        {"id": ticket_id},
    ).first()
    if not cur:
        raise HTTPException(status_code=404, detail=f"unknown ticket {ticket_id}")

    status, priority, technician_id, sla_due_at, created_at, entity_id = cur
    sets: list[str] = []
    params: dict = {"id": ticket_id}

    if payload.technician_id is not None:
        if payload.technician_id == "":
            sets.append("technician_id = NULL")
        else:
            ok = db.execute(
                text("SELECT 1 FROM technicians WHERE id = :t"),
                {"t": payload.technician_id},
            ).first()
            if not ok:
                raise HTTPException(
                    status_code=400,
                    detail=f"unknown technician_id {payload.technician_id!r}",
                )
            sets.append("technician_id = :technician_id")
            params["technician_id"] = payload.technician_id
            # Assigning someone implies the ticket advanced past 'open'.
            if payload.status is None and status == "open":
                sets.append("status = 'assigned'")
                status = "assigned"

    if payload.priority is not None:
        if payload.priority not in PRIORITIES:
            raise HTTPException(
                status_code=400,
                detail=f"unknown priority {payload.priority!r}; expected one of {list(PRIORITIES)}",
            )
        sets.append("priority = :priority")
        params["priority"] = payload.priority
        # SLA is derived from priority, so re-base the deadline from created_at.
        base = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
        params["sla_due_at"] = base + timedelta(hours=SLA_HOURS[payload.priority])
        sets.append("sla_due_at = :sla_due_at")

    if payload.status is not None:
        if payload.status not in TICKET_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"unknown status {payload.status!r}; expected one of {list(TICKET_STATUSES)}",
            )
        if payload.status != status and payload.status not in _ALLOWED[status]:
            raise HTTPException(
                status_code=409,
                detail=f"illegal transition {status} -> {payload.status}",
            )
        sets.append("status = :status")
        params["status"] = payload.status
        if payload.status == "done":
            sets.append("completed_at = COALESCE(completed_at, now())")
            sets.append("verification = CASE WHEN verification = 'none'"
                        " THEN 'pending' ELSE verification END")
        if payload.status == "closed":
            sets.append("verification = CASE WHEN verification = 'pending'"
                        " THEN 'verified' ELSE verification END")

    if not sets:
        return _fetch(db, ticket_id)

    db.execute(
        text(f"UPDATE tickets SET {', '.join(sets)} WHERE id = :id"), params
    )
    db.commit()

    if payload.technician_id is not None:
        tech_mod.recount(db)
        db.commit()

    return _fetch(db, ticket_id)


# --------------------------------------------------------------------------- #
# POST /api/tickets/{id}/complete
# --------------------------------------------------------------------------- #
@router.post("/tickets/{ticket_id}/complete", response_model=TicketOut)
async def complete_ticket(
    ticket_id: str,
    note: str = Form(""),
    photo: UploadFile | None = File(None),
    db: Session = Depends(get_db),
) -> TicketOut:
    """Mark done, set verification=pending, and clear the simulated fault.

    Aditya's verification pass then flips pending -> verified/failed once it sees
    the readings settle. clear_fault() must run here, not on 'closed', or the
    simulator keeps replaying the fault and the fix can never verify.
    """
    row = db.execute(
        text("SELECT status, entity_id FROM tickets WHERE id = :id"), {"id": ticket_id}
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"unknown ticket {ticket_id}")
    status, entity_id = row
    if status == "closed":
        raise HTTPException(status_code=409, detail="ticket is already closed")

    photo_path = None
    if photo is not None and photo.filename:
        suffix = Path(photo.filename).suffix.lower()
        if suffix not in (".jpg", ".jpeg", ".png", ".webp"):
            raise HTTPException(
                status_code=400, detail="photo must be .jpg, .jpeg, .png or .webp"
            )
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        name = f"{ticket_id}-{uuid.uuid4().hex[:8]}{suffix}"
        with (UPLOAD_DIR / name).open("wb") as fh:
            shutil.copyfileobj(photo.file, fh)
        # Served by main.py's /uploads mount.
        photo_path = f"/uploads/{name}"

    db.execute(
        text(
            """
            UPDATE tickets
            SET status = 'done',
                completed_at = now(),
                completion_note = COALESCE(NULLIF(:note, ''), completion_note),
                completion_photo = COALESCE(:photo, completion_photo),
                verification = 'pending'
            WHERE id = :id
            """
        ),
        {"id": ticket_id, "note": note or "", "photo": photo_path},
    )
    db.commit()

    # Imported here: insights/ pulls pandas, and this endpoint must stay fast.
    try:
        from ..insights.router import clear_fault

        clear_fault(entity_id, db=db)
    except Exception:
        # A broken insights module must not block a technician closing a ticket.
        pass

    return _fetch(db, ticket_id)
