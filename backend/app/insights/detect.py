"""Anomaly detection (D3).

Four detectors, all reading from the `readings` table and writing nothing:

  spike      - value is far above what is normal for this weekday+hour
  ghost_load - power is high while nobody is in the room / the building is shut
  night_leak - water is flowing while the building is shut / empty
  drift      - the slow upward trend that precedes a failure

Thresholds live in THRESHOLDS below so they can be explained to judges.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
from sqlalchemy import text

from .common import baseline_frame, cost_of_extra_kwh

# ------------------------------------------------------------------ tuning

THRESHOLDS = {
    # spike
    "spike_sigma": 3.0,          # above baseline + 3 standard deviations
    "spike_ratio": 1.8,          # ...or 1.8x the baseline, whichever triggers first
    "spike_min_kw": 0.8,         # ignore tiny absolute differences (a 0.1 kW blip)
    # ghost load
    "ghost_min_kw": 1.5,         # power that must be present with nobody there
    "ghost_ratio": 1.5,          # ...and be clearly above the baseline
    # night leak
    "leak_min_lpm": 1.0,         # water flow that counts as a leak
    "leak_ratio": 1.5,
    # drift
    "drift_days": 7,             # compare this window...
    "drift_ratio": 1.15,         # ...against the previous one: 15% rise
    # severity bands, applied to the spike/normal ratio
    "severity_ratio_high": 2.5,
    "severity_ratio_medium": 1.8,
}

# how much of the day a fault is assumed to run, used for the ₹ estimate
_ASSUMED_HOURS_PER_DAY = {"spike": 8, "ghost_load": 8, "night_leak": 4, "drift": 24}

# water tariff, assumed; used only for the leak cost estimate
WATER_INR_PER_KL = 25.0

_EMPTY_EQUIPMENT = pd.DataFrame(columns=["id", "building_id"])


# ------------------------------------------------------------------ loading


def load_readings(db, hours: int = 24 * 14) -> pd.DataFrame:
    """Readings for the recent window, as a plain DataFrame."""
    # UTC, not local: a tz-aware value string-compares wrongly on SQLite and
    # the readings table is always stored in UTC anyway.
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    rows = db.execute(
        text(
            "SELECT ts, entity_id, metric, value FROM readings "
            "WHERE ts >= :since ORDER BY ts"
        ),
        {"since": since},
    ).fetchall()
    df = pd.DataFrame(rows, columns=["ts", "entity_id", "metric", "value"])
    if not df.empty:
        df["ts"] = pd.to_datetime(df["ts"], utc=True)
        df["value"] = pd.to_numeric(df["value"], errors="coerce").fillna(0.0)
    return df


def load_hierarchy(db) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """buildings, rooms, equipment as DataFrames (small tables)."""
    buildings = pd.read_sql(text("SELECT * FROM buildings"), db.connection())
    rooms = pd.read_sql(text("SELECT * FROM rooms"), db.connection())
    equipment = pd.read_sql(text("SELECT * FROM equipment"), db.connection())
    return buildings, rooms, equipment


def _name_map(buildings: pd.DataFrame, rooms: pd.DataFrame,
              equipment: pd.DataFrame) -> dict[str, str]:
    names: dict[str, str] = {}
    for _, row in buildings.iterrows():
        names[row["id"]] = row["name"]
    for _, row in rooms.iterrows():
        names[row["id"]] = row["name"]
    for _, row in equipment.iterrows():
        names[row["id"]] = row["name"]
    return names


def _closed_entities(buildings: pd.DataFrame) -> set[str]:
    """Buildings that are shut at any point (everything except the hostel)."""
    out: set[str] = set()
    for _, row in buildings.iterrows():
        try:
            open_h = int(str(row["open_time"]).split(":")[0])
            close_h = int(str(row["close_time"]).split(":")[0])
        except (TypeError, ValueError):
            continue
        if close_h - open_h < 23:          # not 24x7
            out.add(row["id"])
    return out


def _building_of(entity_id: str, rooms: pd.DataFrame,
                 equipment: pd.DataFrame) -> str | None:
    if entity_id.startswith("B") and "-" not in entity_id:
        return entity_id
    hit = rooms[rooms["id"] == entity_id]
    if not hit.empty:
        return hit.iloc[0]["building_id"]
    hit = equipment[equipment["id"] == entity_id]
    if not hit.empty and hit.iloc[0]["building_id"] is not None:
        return hit.iloc[0]["building_id"]
    if entity_id.startswith("EQ-"):
        return None
    return entity_id.split("-")[0] if "-" in entity_id else None


# ------------------------------------------------------------------ helpers


def _severity(ratio: float) -> str:
    if ratio >= THRESHOLDS["severity_ratio_high"]:
        return "critical"
    if ratio >= THRESHOLDS["severity_ratio_medium"]:
        return "high"
    if ratio > 1.0:
        return "medium"
    return "low"


def _clock(hour: int) -> str:
    return f"{hour:02d}:00"


def _band_lookup(baselines: pd.DataFrame) -> dict[tuple, tuple[float, float]]:
    """(entity, metric, weekday, hour) -> (mean, std)."""
    out: dict[tuple, tuple[float, float]] = {}
    for row in baselines.itertuples(index=False):
        out[(row.entity_id, row.metric, int(row.weekday), int(row.hour))] = (
            float(row.mean), float(row.std),
        )
    return out


def _recent_window(df: pd.DataFrame, hours: int) -> pd.DataFrame:
    if df.empty:
        return df
    cutoff = df["ts"].max() - timedelta(hours=hours)
    return df[df["ts"] >= cutoff]


# ------------------------------------------------------------------ detectors


def detect_spikes(df: pd.DataFrame, baselines: dict, names: dict) -> list[dict]:
    """Value far above the normal for this weekday+hour."""
    alerts: list[dict] = []
    if df.empty:
        return alerts

    power = _recent_window(df[df["metric"] == "power_kw"], 3)
    if power.empty:
        return alerts

    latest = power.sort_values("ts").groupby("entity_id").tail(1)

    for row in latest.itertuples(index=False):
        ts = pd.Timestamp(row.ts)
        key = (row.entity_id, "power_kw", int(ts.dayofweek), int(ts.hour))
        mean, std = baselines.get(key, (0.0, 0.0))
        if mean <= 0:
            continue

        ratio = row.value / mean
        over_sigma = row.value > mean + THRESHOLDS["spike_sigma"] * max(std, 0.05)
        over_ratio = ratio >= THRESHOLDS["spike_ratio"]
        big_enough = (row.value - mean) >= THRESHOLDS["spike_min_kw"]

        if not (big_enough and (over_sigma or over_ratio)):
            continue

        day = ts.strftime("%A")
        alerts.append({
            "entity_id": row.entity_id,
            "metric": "power_kw",
            "kind": "spike",
            "actual": round(float(row.value), 3),
            "expected": round(float(mean), 3),
            "ratio": round(float(ratio), 2),
            "severity": _severity(ratio),
            "explanation": (
                f"{names.get(row.entity_id, row.entity_id)} is using "
                f"{ratio:.1f}× its normal {day} {_clock(int(ts.hour))} load "
                f"({row.value:.1f} kW vs {mean:.1f} kW expected)."
            ),
            "est_cost_inr_month": cost_of_extra_kwh(
                float(row.value - mean), hours=_ASSUMED_HOURS_PER_DAY["spike"]),
        })
    return alerts


def detect_ghost_load(df: pd.DataFrame, baselines: dict, names: dict,
                      buildings: pd.DataFrame, rooms: pd.DataFrame) -> list[dict]:
    """Power still being drawn while the room is empty / the building is shut."""
    alerts: list[dict] = []
    if df.empty:
        return alerts

    closed = _closed_entities(buildings)

    # Ghost load is an overnight phenomenon, so look at every unoccupied
    # overnight reading in the window, not just the most recent tick.
    recent = df[df["ts"].dt.hour.isin([0, 1, 2, 3, 4, 5, 22, 23])]
    if recent.empty:
        return alerts

    power = recent[recent["metric"] == "power_kw"]
    occ = (recent[recent["metric"] == "occupancy"]
           .groupby("entity_id")["value"].mean().to_dict())

    # collapse to one candidate per entity: the worst unoccupied overnight draw
    candidates: dict[str, tuple] = {}
    for row in power.itertuples(index=False):
        ts = pd.Timestamp(row.ts)
        people = occ.get(row.entity_id)
        if people is not None and people > 0:
            continue                       # somebody was there, not a ghost
        key = (row.entity_id, "power_kw", int(ts.dayofweek), int(ts.hour))
        mean, _ = baselines.get(key, (0.0, 0.0))
        extra = float(row.value) - mean
        if row.entity_id not in candidates or extra > candidates[row.entity_id][1]:
            candidates[row.entity_id] = (row, extra, mean, ts)

    for row, extra, mean, ts in candidates.values():
        building = _building_of(row.entity_id, rooms, _EMPTY_EQUIPMENT)
        shut = building in closed and not (8 <= int(ts.hour) < 18)
        people = occ.get(row.entity_id)
        empty = people is not None and people <= 0
        if not (shut or empty):
            continue

        key = (row.entity_id, "power_kw", int(ts.dayofweek), int(ts.hour))
        mean, _ = baselines.get(key, (0.0, 0.0))
        if row.value < THRESHOLDS["ghost_min_kw"]:
            continue
        if mean > 0 and row.value < mean * THRESHOLDS["ghost_ratio"]:
            continue

        ratio = (row.value / mean) if mean > 0 else 99.0
        why = "the building is closed" if shut else "nobody is in the room"
        alerts.append({
            "entity_id": row.entity_id,
            "metric": "power_kw",
            "kind": "ghost_load",
            "actual": round(float(row.value), 3),
            "expected": round(float(mean), 3),
            "ratio": round(float(min(ratio, 99.0)), 2),
            "severity": _severity(max(ratio, 2.0)),
            "explanation": (
                f"{names.get(row.entity_id, row.entity_id)} is drawing "
                f"{row.value:.1f} kW at {_clock(int(ts.hour))} while {why}."
            ),
            "est_cost_inr_month": cost_of_extra_kwh(
                float(max(row.value - mean, row.value * 0.5)),
                hours=_ASSUMED_HOURS_PER_DAY["ghost_load"]),
        })
    return alerts


def detect_night_leaks(df: pd.DataFrame, baselines: dict, names: dict,
                       buildings: pd.DataFrame, rooms: pd.DataFrame) -> list[dict]:
    """Water flowing while the building is shut or nobody is there."""
    alerts: list[dict] = []
    if df.empty:
        return alerts

    closed = _closed_entities(buildings)

    # A leak shows up as night-time flow, so scan the whole overnight window.
    recent = df[df["ts"].dt.hour.isin([0, 1, 2, 3, 4, 5, 22, 23])]
    if recent.empty:
        return alerts

    water = recent[recent["metric"] == "water_lpm"]
    occ = (recent[recent["metric"] == "occupancy"]
           .groupby("entity_id")["value"].mean().to_dict())

    candidates: dict[str, tuple] = {}
    for row in water.itertuples(index=False):
        ts = pd.Timestamp(row.ts)
        hour = int(ts.hour)
        key = (row.entity_id, "water_lpm", int(ts.dayofweek), hour)
        mean, _ = baselines.get(key, (0.0, 0.0))
        extra = float(row.value) - mean
        if row.entity_id not in candidates or extra > candidates[row.entity_id][1]:
            candidates[row.entity_id] = (row, extra, mean, ts)

    for row, extra, mean, ts in candidates.values():
        hour = int(ts.hour)
        building = _building_of(row.entity_id, rooms, _EMPTY_EQUIPMENT)
        shut = building in closed and not (8 <= hour < 18)
        night = hour < 6 or hour >= 22

        people = occ.get(row.entity_id)
        empty = people is not None and people <= 0

        if not (shut or night or empty):
            continue
        if row.value < THRESHOLDS["leak_min_lpm"]:
            continue
        if mean > 0 and row.value < mean * THRESHOLDS["leak_ratio"]:
            continue

        ratio = (row.value / mean) if mean > 0 else 99.0
        alerts.append({
            "entity_id": row.entity_id,
            "metric": "water_lpm",
            "kind": "night_leak",
            "actual": round(float(row.value), 3),
            "expected": round(float(mean), 3),
            "ratio": round(float(min(ratio, 99.0)), 2),
            "severity": _severity(max(ratio, 2.0)),
            "explanation": (
                f"{names.get(row.entity_id, row.entity_id)} is drawing "
                f"{row.value:.1f} l/min of water at {_clock(hour)} — "
                f"steady flow with nobody there points to a leak."
            ),
            "est_cost_inr_month": int(round(
                float(max(row.value - mean, row.value * 0.5)) * 60
                * _ASSUMED_HOURS_PER_DAY["night_leak"] * 30 / 1000
                * WATER_INR_PER_KL)),
        })
    return alerts


def detect_drift(df: pd.DataFrame, names: dict) -> list[dict]:
    """Compare this week's mean against last week's: a 15% rise is a drift."""
    alerts: list[dict] = []
    if df.empty:
        return alerts

    power = df[df["metric"] == "power_kw"].copy()
    if power.empty:
        return alerts
    power["ts"] = pd.to_datetime(power["ts"])

    end = power["ts"].max()
    days = THRESHOLDS["drift_days"]
    this_week = power[power["ts"] > end - timedelta(days=days)]
    prev_week = power[(power["ts"] > end - timedelta(days=2 * days))
                      & (power["ts"] <= end - timedelta(days=days))]
    if this_week.empty or prev_week.empty:
        return alerts

    a = this_week.groupby("entity_id")["value"].mean()
    b = prev_week.groupby("entity_id")["value"].mean()
    common = a.index.intersection(b.index)

    for entity_id in common:
        before, now = float(b[entity_id]), float(a[entity_id])
        if before < 0.5:                       # ignore near-zero baselines
            continue
        ratio = now / before
        if ratio < THRESHOLDS["drift_ratio"]:
            continue
        alerts.append({
            "entity_id": entity_id,
            "metric": "power_kw",
            "kind": "drift",
            "actual": round(now, 3),
            "expected": round(before, 3),
            "ratio": round(ratio, 2),
            "severity": "high" if ratio >= 1.3 else "medium",
            "explanation": (
                f"{names.get(entity_id, entity_id)} is drawing "
                f"{(ratio - 1) * 100:.0f}% more than last week "
                f"({now:.1f} kW vs {before:.1f} kW) — a rising trend, "
                f"typical of ageing equipment."
            ),
            "est_cost_inr_month": cost_of_extra_kwh(
                max(now - before, 0.0), hours=_ASSUMED_HOURS_PER_DAY["drift"]),
        })
    return alerts


def detect_all(db, hours: int = 24 * 3) -> list[dict]:
    """Run every detector over recent readings and return alert dicts."""
    df = load_readings(db, hours=24 * 14)
    if df.empty:
        return []

    buildings, rooms, equipment = load_hierarchy(db)
    names = _name_map(buildings, rooms, equipment)
    baselines = _band_lookup(baseline_frame(df))

    alerts: list[dict] = []
    alerts += detect_spikes(df, baselines, names)
    alerts += detect_ghost_load(df, baselines, names, buildings, rooms)
    alerts += detect_night_leaks(df, baselines, names, buildings, rooms)
    alerts += detect_drift(_recent_window(df, 24 * 14), names)

    # one alert per entity+kind is enough; keep the most severe
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    best: dict[tuple, dict] = {}
    for alert in alerts:
        key = (alert["entity_id"], alert["kind"])
        if key not in best or order[alert["severity"]] < order[best[key]["severity"]]:
            best[key] = alert
    return sorted(best.values(), key=lambda a: order[a["severity"]])
