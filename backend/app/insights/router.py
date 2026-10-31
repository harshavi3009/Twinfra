"""Insights router skeleton - owned by Aditya (see docs/contract/api.md).

Ayaan created this so the tickets module can call clear_fault() and so the
frontend can hit /api/insights/* without waiting. Fill in the endpoints:

  GET  /api/insights/alerts?active=true
  POST /api/insights/run
  POST /api/insights/sim/fault        {entity_id, kind}
  GET  /api/insights/sim/faults
  GET  /api/insights/interventions
  POST /api/insights/whatif
  GET  /api/insights/reports/sustainability?days=30
  GET  /api/insights/reports/asset-health

Contract: docs/contract/api.md  ("Insights" section)
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/insights", tags=["insights"])


def clear_fault(entity_id: str) -> None:
    """Called by POST /api/tickets/{id}/complete.

    When an entity is repaired, drop its active faults/alerts so the simulator
    stops replaying them and verification can confirm the readings went back
    to normal. No-op until Aditya implements it.
    """
    return None
