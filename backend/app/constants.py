"""Shared backend constants. Contract source: docs/contract/db.md bottom.

Aditya keeps his own copy in insights/constants.py for the ml/ scripts that can't
import the app; these are what the API uses. Keep them in sync if the tariff or
grid factor ever change.
"""

# ₹ per kWh - assumed tariff for cost estimates
TARIFF_INR_PER_KWH = 9.0

# kg CO2 per kWh - CEA grid emission factor (verify before the PPT)
CO2_KG_PER_KWH = 0.71

# SLA hours by ticket priority (contract/db.md)
SLA_HOURS = {
    "critical": 4,
    "high": 12,
    "medium": 48,
    "low": 72,
}

PRIORITIES = ("critical", "high", "medium", "low")

# Status enums
STATUS_OK = "ok"
STATUS_WARNING = "warning"
STATUS_CRITICAL = "critical"
STATUS_OFFLINE = "offline"

TICKET_STATUSES = ("open", "assigned", "in_progress", "done", "closed")

# Equipment.status (db.md) -> the ok/warning/critical/offline enum api.md uses
EQUIPMENT_STATUS_TO_HEALTH = {
    "running": STATUS_OK,
    "idle": STATUS_OK,
    "maintenance": STATUS_WARNING,
    "fault": STATUS_CRITICAL,
}
