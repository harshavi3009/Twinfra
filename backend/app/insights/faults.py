"""In-memory fault injection for the demo (D2).

A "fault" is what we inject on cue so the dashboard reacts within seconds.
The simulator reads this list on every tick and bends its readings accordingly.

Faults live in process memory: restarting the backend clears them, which is
exactly what we want before a demo run.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone

# kinds the contract allows
FAULT_KINDS = ("spike", "ghost_load", "night_leak")

_lock = threading.Lock()
_active: dict[str, dict] = {}


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def add_fault(entity_id: str, kind: str, factor: float | None = None) -> dict:
    """Inject (or refresh) a fault for one entity."""
    if kind not in FAULT_KINDS:
        raise ValueError(f"unknown fault kind {kind!r}; expected one of {FAULT_KINDS}")

    with _lock:
        existing = _active.get(entity_id)
        if existing and existing["kind"] == kind:
            existing["updated_at"] = _now()
            return dict(existing)

        fault = {
            "entity_id": entity_id,
            "kind": kind,
            "factor": factor if factor is not None else (2.5 if kind == "spike" else 1.0),
            "started_at": _now(),
            "updated_at": _now(),
        }
        _active[entity_id] = fault
        return dict(fault)


def list_faults() -> list[dict]:
    with _lock:
        return [dict(f) for f in _active.values()]


def get_fault(entity_id: str) -> dict | None:
    with _lock:
        fault = _active.get(entity_id)
        return dict(fault) if fault else None


def clear_fault(entity_id: str) -> None:
    """Drop the fault for one entity (ticket completed / repair verified)."""
    with _lock:
        _active.pop(entity_id, None)


def clear_all() -> None:
    with _lock:
        _active.clear()


def clear_faults_for(entity_ids: list[str]) -> int:
    """Drop faults for a list of entities, returns how many were removed."""
    removed = 0
    with _lock:
        for eid in entity_ids:
            if _active.pop(eid, None) is not None:
                removed += 1
    return removed
