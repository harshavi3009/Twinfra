from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db

router = APIRouter(tags=["health"])


@router.get("/api/health")
def health() -> dict:
    """Liveness only. Must not touch the DB so a cold Supabase project
    can't make the frontend think the API is down."""
    return {"ok": True}


@router.get("/api/health/db")
def health_db(db: Session = Depends(get_db)) -> dict:
    """DB connectivity + which tables actually exist."""
    db.execute(text("SELECT 1"))
    tables = [
        row[0]
        for row in db.execute(
            text(
                "SELECT tablename FROM pg_tables "
                "WHERE schemaname = 'public' ORDER BY tablename"
            )
        )
    ]
    return {"ok": True, "tables": tables, "count": len(tables)}
