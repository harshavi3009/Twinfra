"""Utility connection graph + impact analysis (A2).

GET /api/connections             - the tree as nodes/edges
GET /api/connections/{id}/impact - everything downstream of a node

The graph is a tree rooted at UT-SUB / UT-TANK, so "downstream" is a plain
recursive walk. Aditya's insights/common.py has the same walker; this one uses
SQL so the API doesn't need pandas for a graph query.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import schemas
from ..db import get_db

router = APIRouter(prefix="/api", tags=["connections"])


@router.get("/connections", response_model=schemas.ConnectionsResponse)
def get_connections(db: Session = Depends(get_db)) -> schemas.ConnectionsResponse:
    edges = db.execute(
        text("SELECT from_id, to_id, utility FROM connections ORDER BY id")
    ).fetchall()

    node_ids: set[str] = set()
    for frm, to, _utility in edges:
        node_ids.add(frm)
        node_ids.add(to)

    # Type every node so the frontend can pick an icon without extra lookups.
    types: dict[str, str] = {}
    for table, kind, col in (
        ("buildings", "building", "id"),
        ("floors", "floor", "id"),
        ("rooms", "room", "id"),
        ("equipment", "equipment", "id"),
    ):
        for (nid,) in db.execute(text(f"SELECT {col} FROM {table}")).fetchall():
            types[nid] = kind
    types.setdefault("UT-SUB", "substation")
    types.setdefault("UT-TANK", "water_tank")

    nodes = [
        schemas.ConnectionNode(id=nid, type=types.get(nid, "unknown"))
        for nid in sorted(node_ids)
    ]
    return schemas.ConnectionsResponse(
        nodes=nodes,
        edges=[{"from": frm, "to": to, "utility": u} for frm, to, u in edges],
    )


@router.get("/connections/{node_id}/impact", response_model=schemas.ImpactResponse)
def get_impact(node_id: str, db: Session = Depends(get_db)) -> schemas.ImpactResponse:
    """Rooms + equipment that lose service if node_id goes down."""
    exists = db.execute(
        text(
            "SELECT 1 FROM connections WHERE from_id = :n OR to_id = :n LIMIT 1"
        ),
        {"n": node_id},
    ).first()
    if not exists:
        raise HTTPException(status_code=404, detail=f"unknown connection node {node_id}")

    rows = db.execute(
        text(
            """
            WITH RECURSIVE down(id) AS (
                SELECT CAST(:n AS text)
                UNION
                SELECT c.to_id FROM connections c JOIN down d ON c.from_id = d.id
            )
            SELECT id FROM down
            """
        ),
        {"n": node_id},
    ).fetchall()
    ids = sorted({r[0] for r in rows})

    rooms = db.execute(
        text("SELECT count(*) FROM rooms WHERE id = ANY(:ids)"), {"ids": ids}
    ).scalar_one()
    equipment = db.execute(
        text("SELECT count(*) FROM equipment WHERE id = ANY(:ids)"), {"ids": ids}
    ).scalar_one()

    return schemas.ImpactResponse(
        id=node_id,
        affected=schemas.Affected(
            rooms=int(rooms), equipment=int(equipment), ids=ids
        ),
    )
