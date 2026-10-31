"""Derive the ok/warning/critical/offline status api.md needs.

Nothing in the DB stores it: `equipment.status` is lifecycle (running/idle/fault/
maintenance), while building/room/equipment *health* is computed from active
alerts + predictions + equipment lifecycle state. One function so every endpoint
agrees.
"""

from sqlalchemy import text
from sqlalchemy.orm import Session

from .constants import (
    EQUIPMENT_STATUS_TO_HEALTH,
    STATUS_CRITICAL,
    STATUS_OFFLINE,
    STATUS_OK,
    STATUS_WARNING,
)

_SEVERITY_RANK = {"critical": 3, "high": 2, "medium": 1, "low": 0}
_ORDER = [STATUS_OK, STATUS_WARNING, STATUS_CRITICAL, STATUS_OFFLINE]


def worse(a: str, b: str) -> str:
    """offline is terminal for a *single* asset; otherwise take the worst."""
    if a == STATUS_OFFLINE:
        return a
    if b == STATUS_OFFLINE:
        return b
    return a if _ORDER.index(a) >= _ORDER.index(b) else b


def active_alert_status(db: Session) -> dict[str, str]:
    """entity_id -> worst active alert severity, as a health status."""
    rows = db.execute(
        text(
            "SELECT entity_id, severity FROM alerts WHERE active IS TRUE"
        )
    ).fetchall()
    out: dict[str, str] = {}
    for entity_id, severity in rows:
        mapped = (
            STATUS_CRITICAL
            if _SEVERITY_RANK.get(severity, 0) >= 2
            else STATUS_WARNING
        )
        out[entity_id] = worse(out.get(entity_id, STATUS_OK), mapped)
    return out


def risk_status(db: Session, threshold: float = 0.7) -> dict[str, str]:
    """equipment_id -> critical if predicted failure risk is high."""
    rows = db.execute(
        text("SELECT equipment_id, risk FROM predictions WHERE risk >= :t"),
        {"t": threshold},
    ).fetchall()
    return {eq: STATUS_CRITICAL for eq, _risk in rows}


def equipment_status(status: str | None) -> str:
    return EQUIPMENT_STATUS_TO_HEALTH.get(status or "running", STATUS_OK)
