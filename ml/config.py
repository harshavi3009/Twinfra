"""Shared constants for CampusTwin data generation, simulation and detection.

Everything here is an ASSUMPTION unless it came from `contract/db.md`.
Keep tuning knobs in this one file so they are easy to explain to judges.
"""

from __future__ import annotations

import os
from pathlib import Path

# ---------------------------------------------------------------- paths
ML_DIR = Path(__file__).resolve().parent
REPO_ROOT = ML_DIR.parent
DATA_DIR = REPO_ROOT / "data"

API_URL = os.environ.get("CAMPUSTWIN_API_URL", "http://localhost:8000")

# ---------------------------------------------------------------- simulation
SEED = 42
READING_INTERVAL_MINUTES = 60          # contract: hourly readings
HISTORY_DAYS = 14                      # contract: last 14 days up to "now"
SIM_TICK_SECONDS = 3.0                 # D2: one simulated hour every ~3 s
SIM_HOURS_PER_TICK = 1                 # each tick advances the clock by 1 h
SIM_NOISE = 0.05                       # relative gaussian noise on every value
SIM_RUN_EVERY_TICKS = 3                # POST /api/insights/run cadence

# ---------------------------------------------------------------- money / carbon
TARIFF_INR_PER_KWH = 9.0               # contract constant (assumed)
CO2_KG_PER_KWH = 0.71                  # contract constant (assumed, CEA grid factor)
CO2_KG_PER_TREE_PER_YEAR = 21.0        # D4 assumption

# ---------------------------------------------------------------- campus layout
# From contract/db.md. If Rishi + Aditya change positions, update BOTH places.
BUILDINGS = [
    # id,   name,                  floors, pos_x, pos_z, width, depth, open, close, days
    ("B1", "Main Academic Block",  3,   0,    0,   40, 16, "08:00", "18:00", "Mon-Sat"),
    ("B2", "Computer & IT Block",  3,  30,   30,   24, 16, "08:00", "20:00", "Mon-Sat"),
    ("B3", "Mechanical Workshop",  1, -35,   25,   30, 14, "08:00", "17:00", "Mon-Sat"),
    ("B4", "Library",              2, -30,  -25,   20, 20, "08:00", "22:00", "Mon-Sun"),
    ("B5", "Hostel",               4,  35,  -30,   18, 28, "00:00", "23:59", "Mon-Sun"),
    ("B6", "Admin Block",          2,   0,   40,   22, 12, "09:00", "18:00", "Mon-Fri"),
]

UTILITIES = [
    # id,      type,          x,   z
    ("UT-SUB", "substation", -50,   0),
    ("UT-TANK", "water_tank", 50,   0),
]

# Room mix per building: (room_type, count, power_kw_range, capacity)
ROOM_MIX = {
    "B1": [("classroom", 3, (0.8, 2.5), 60),
           ("lab", 1, (3.0, 6.0), 40),
           ("office", 2, (0.4, 1.2), 8),
           ("server_room", 1, (2.0, 3.0), 2)],
    "B2": [("lab", 4, (6.0, 12.0), 40),
           ("classroom", 3, (0.8, 2.5), 60),
           ("office", 2, (0.4, 1.2), 8),
           ("server_room", 1, (5.0, 8.0), 2)],
    "B3": [("workshop", 2, (8.0, 18.0), 30),
           ("office", 1, (0.4, 1.2), 8)],
    "B4": [("library_hall", 3, (2.0, 4.0), 120),
           ("office", 1, (0.4, 1.2), 8)],
    "B5": [("hostel_room", 8, (0.3, 0.8), 4),
           ("office", 1, (0.4, 1.2), 4)],
    "B6": [("office", 4, (0.4, 1.5), 10),
           ("classroom", 1, (0.8, 2.5), 40)],
}

# Equipment mix per room_type: (eq_type, count, rated_kw_range)
EQUIPMENT_MIX = {
    "classroom": [("ac", 2, (1.5, 2.2)), ("lighting", 1, (0.4, 0.8))],
    "lab": [("ac", 2, (1.5, 2.5)), ("computers", 1, (2.5, 6.0)), ("lighting", 1, (0.4, 0.8))],
    "office": [("ac", 1, (1.1, 1.6)), ("computers", 1, (0.5, 1.2)), ("lighting", 1, (0.2, 0.4))],
    "workshop": [("lathe", 2, (3.0, 7.5)), ("lighting", 1, (0.6, 1.2)), ("pump", 1, (1.5, 3.0))],
    "library_hall": [("ac", 2, (2.2, 3.5)), ("lighting", 1, (0.8, 1.5))],
    "hostel_room": [("ac", 1, (0.9, 1.5)), ("lighting", 1, (0.1, 0.3))],
    "server_room": [("server_rack", 2, (1.5, 3.0)), ("ac", 2, (2.2, 3.5))],
}

# Building-level utility equipment (one per building)
BUILDING_EQUIPMENT = [("lift", 1, (3.0, 5.0)), ("water_cooler", 1, (0.5, 1.0))]
# Substation transformer
UTILITY_EQUIPMENT = [("transformer", 1, (200.0, 250.0))]

EQ_TYPES = ["ac", "lighting", "computers", "pump", "transformer", "lathe",
            "water_cooler", "lift", "server_rack"]
CRITICALITY_BY_TYPE = {
    "transformer": "critical", "server_rack": "critical", "lift": "high",
    "pump": "high", "ac": "medium", "computers": "medium", "lathe": "medium",
    "lighting": "low", "water_cooler": "low",
}
OWNER_DEPTS = ["Civil", "Electrical", "Mechanical", "IT", "Admin", "Hostel"]

# ---------------------------------------------------------------- workforce
TECHNICIANS = [
    ("T-001", "Ramesh Patil",     "electrical"),
    ("T-002", "Sunita Deshmukh",  "hvac"),
    ("T-003", "Imran Sheikh",     "plumbing"),
    ("T-004", "Vijay Kamble",     "mechanical"),
    ("T-005", "Priya Joshi",      "it"),
    ("T-006", "Ganesh Wankhede",  "electrical"),
    ("T-007", "Asha Meshram",     "hvac"),
    ("T-008", "Ravi Chauhan",     "mechanical"),
]

SLA_HOURS = {"critical": 4, "high": 12, "medium": 48, "low": 72}
