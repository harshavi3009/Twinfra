"""Insights router - owned by Aditya (see docs/contract/api.md).

D2 implements the fault-injection endpoints and a real clear_fault().
D3 adds /run, D4 adds interventions/whatif/reports - the stubs below return
contract-shaped empty payloads so the frontend can build against them now.

Contract: docs/contract/api.md  ("Insights" section)
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import faults, reporting

router = APIRouter(prefix="/api/insights", tags=["insights"])


# ------------------------------------------------------------------ schemas


class FaultRequest(BaseModel):
    entity_id: str = Field(..., min_length=1)
    kind: str = Field(..., description="spike | ghost_load | night_leak")


# ------------------------------------------------------------------ faults (D2)


@router.post("/sim/fault")
def inject_fault(body: FaultRequest) -> dict:
    """Inject a demo fault. The simulator picks it up on its next tick."""
    try:
        fault = faults.add_fault(body.entity_id, body.kind)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return fault


@router.get("/sim/faults")
def active_faults() -> list[dict]:
    """Active faults. The simulator reads this every tick."""
    return faults.list_faults()


@router.delete("/sim/faults")
def reset_faults() -> dict:
    """Clear every injected fault (handy before a demo run)."""
    faults.clear_all()
    return {"cleared": True}


def clear_fault(entity_id: str) -> None:
    """Called by POST /api/tickets/{id}/complete.

    When an entity is repaired, drop its active faults so the simulator stops
    replaying them and verification can confirm the readings went back to normal.
    """
    faults.clear_fault(entity_id)
    reporting.clear_alert_state(entity_id)


# ------------------------------------------------------------------ stubs (D3/D4)


@router.get("/alerts")
def alerts(active: bool = True) -> list[dict]:
    return reporting.get_alerts(active=active)


@router.post("/run")
def run_insights() -> dict:
    return reporting.run_all()


@router.get("/interventions")
def interventions() -> list[dict]:
    return reporting.get_interventions()


@router.get("/reports/sustainability")
def sustainability(days: int = 30) -> dict:
    return reporting.sustainability(days=days)


@router.get("/reports/asset-health")
def asset_health() -> dict:
    return reporting.asset_health()
