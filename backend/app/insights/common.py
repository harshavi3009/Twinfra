"""Shared helpers for the insights module and the ML scripts.

Kept dependency-light: plain SQLAlchemy + Pandas. No FastAPI imports, so
`ml/simulator.py` can use it without starting a server.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

# make `ml/config.py` importable from the backend too
_ML_DIR = Path(__file__).resolve().parents[3] / "ml"
if str(_ML_DIR) not in sys.path:
    sys.path.insert(0, str(_ML_DIR))

import config as C  # noqa: E402

# ---------------------------------------------------------------- entity graph


def _children_map(db) -> dict[str, list[str]]:
    """parent_id -> [child_id] for electricity connections.

    Cached per call on the caller's side; the tree is tiny (a few hundred rows).
    """
    from sqlalchemy import text

    rows = db.execute(text(
        "SELECT from_id, to_id FROM connections WHERE utility = 'electricity'"
    )).fetchall()
    out: dict[str, list[str]] = {}
    for parent, child in rows:
        out.setdefault(parent, []).append(child)
    return out


def descendants(db, entity_id: str) -> list[str]:
    """Every entity under `entity_id` (exclusive) in the electricity tree."""
    kids = _children_map(db)
    out, stack = [], [entity_id]
    while stack:
        node = stack.pop()
        for child in kids.get(node, []):
            out.append(child)
            stack.append(child)
    return out


def ancestors(db, entity_id: str) -> list[str]:
    """Walk up from an entity to the substation."""
    from sqlalchemy import text

    rows = db.execute(text(
        "SELECT from_id, to_id FROM connections WHERE utility = 'electricity'"
    )).fetchall()
    parent_of = {child: parent for parent, child in rows}
    out, node, seen = [], entity_id, set()
    while node in parent_of and parent_of[node] not in seen:
        node = parent_of[node]
        seen.add(node)
        out.append(node)
    return out


# ---------------------------------------------------------------- baselines


def baseline_frame(readings: pd.DataFrame) -> pd.DataFrame:
    """Typical value per entity + metric + weekday + hour, from history.

    Returns a frame indexed by (entity_id, metric, weekday, hour) with
    `mean` and `std` columns. Used by detection and by the readings API.
    """
    if readings.empty:
        return pd.DataFrame(columns=["entity_id", "metric", "weekday", "hour", "mean", "std"])

    df = readings.copy()
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df["weekday"] = df["ts"].dt.dayofweek
    df["hour"] = df["ts"].dt.hour

    grouped = (
        df.groupby(["entity_id", "metric", "weekday", "hour"])["value"]
        .agg(["mean", "std", "count"])
        .reset_index()
    )
    grouped["std"] = grouped["std"].fillna(0.0)
    return grouped


def band(readings: pd.DataFrame, entity_id: str, metric: str,
         hours: int = 24) -> dict | None:
    """Normal band (low/high) for the most recent `hours` of one series."""
    df = readings[(readings["entity_id"] == entity_id) & (readings["metric"] == metric)]
    if df.empty:
        return None
    recent = df.sort_values("ts").tail(hours)
    mean = float(recent["value"].mean())
    std = float(recent["value"].std(ddof=0) or 0.0)
    return {"low": round(max(mean - 2 * std, 0.0), 3), "high": round(mean + 2 * std, 3)}


# ---------------------------------------------------------------- money


def cost_of_extra_kwh(extra_kw: float, hours: int = 1, days: int = 30) -> int:
    """Rupee/month for wasted kW that runs `hours` per day."""
    return int(round(extra_kw * hours * days * C.TARIFF_INR_PER_KWH))


def kwh_to_co2(kwh: float) -> float:
    return float(kwh) * C.CO2_KG_PER_KWH


def now_utc() -> datetime:
    return datetime.now(tz=_UTC)


def hours_ago(h: float) -> datetime:
    return now_utc() - timedelta(hours=h)


try:
    from datetime import UTC as _UTC
except ImportError:  # pragma: no cover - py<3.11
    from datetime import timezone as _tz
    _UTC = _tz.utc
