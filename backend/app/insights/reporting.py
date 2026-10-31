"""Placeholder for D3/D4 response shapes.

D3 fills `run_all()` (detect -> alert -> auto-ticket -> predict -> verify).
D4 fills interventions, sustainability and asset-health.
Until then every function returns a contract-shaped empty payload so the
frontend and the simulator can be wired up without 500s.
"""

from __future__ import annotations

_ALERTS: list[dict] = []


def clear_alert_state(entity_id: str) -> None:
    """Deactivate any in-memory alerts for a repaired entity."""
    for alert in _ALERTS:
        if alert["entity_id"] == entity_id:
            alert["active"] = False


def get_alerts(active: bool = True) -> list[dict]:
    return [a for a in _ALERTS if a["active"]] if active else list(_ALERTS)


def run_all() -> dict:
    return {"alerts_new": 0, "tickets_created": 0, "verified": 0}


def get_interventions() -> list[dict]:
    return []


def sustainability(days: int = 30) -> dict:
    return {
        "kwh": 0.0, "water_kl": 0.0, "co2_kg": 0.0, "cost_inr": 0,
        "vs_prev_pct": 0.0, "score": 0, "trees_equiv": 0.0, "by_building": [],
    }


def asset_health() -> dict:
    return {"buildings": [], "worst_assets": []}
