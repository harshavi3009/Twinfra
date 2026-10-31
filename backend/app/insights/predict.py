"""Failure prediction (D3).

A RandomForest answers one question: how likely is this piece of equipment to
fail soon? It is trained at startup on synthetic-but-plausible labels, because
a 14-day-old campus has no real failure history to learn from.

Features (all things an estate office actually tracks):
  age_days             - how old the asset is
  days_since_service   - time since the last maintenance entry
  failures_180d        - repairs in the last 180 days
  anomalies_7d         - alerts raised against it this week
  load_ratio           - current kW / rated kW (over-working an asset wears it out)
  warranty_days_left   - a proxy for "old and unsupported"
  criticality          - how much it matters if it fails

Output: risk 0..1, days_to_failure, and the 2-3 reasons in plain words.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier

from . import common as _common  # noqa: F401  (sets up ml/ on sys.path)
import config as C

SEED = C.SEED

CRITICALITY_SCORE = {"critical": 3, "high": 2, "medium": 1, "low": 0}

# Feature order matters: it is baked into the trained model.
FEATURES = [
    "age_days",
    "days_since_service",
    "failures_180d",
    "anomalies_7d",
    "load_ratio",
    "warranty_days_left",
    "criticality_score",
]

_MODEL: RandomForestClassifier | None = None


# ------------------------------------------------------------------ training


def _synthetic_training_set(n: int = 6000, seed: int = SEED) -> tuple[np.ndarray, np.ndarray]:
    """Plausible failure labels so the model has something to learn from.

    The rules below are the domain assumptions; the forest learns them plus the
    interactions. `y=1` means "fails within 30 days".
    """
    rng = np.random.default_rng(seed)

    age = rng.integers(0, 4000, n)
    since = rng.integers(1, 730, n)
    fails = rng.integers(0, 6, n)
    anom = rng.integers(0, 9, n)
    load = np.clip(rng.normal(0.7, 0.25, n), 0.05, 2.5)
    warranty = rng.integers(-2000, 1500, n)
    crit = rng.integers(0, 4, n)

    score = (
        0.0009 * age
        + 0.0028 * np.maximum(0, 240 - since)
        + 0.75 * fails
        + 0.50 * anom
        + 1.8 * np.maximum(0, load - 1.0)
        + 0.0007 * np.maximum(0, -warranty)
        + 0.12 * crit
        - 5.2
    )
    p = 1.0 / (1.0 + np.exp(-score))
    y = (rng.random(n) < p).astype(int)

    X = np.column_stack([age, since, fails, anom, load, warranty, crit])
    return X.astype(float), y


def train() -> RandomForestClassifier:
    """Train once; cached for the process lifetime."""
    global _MODEL
    if _MODEL is None:
        X, y = _synthetic_training_set()
        model = RandomForestClassifier(
            n_estimators=180,
            max_depth=8,
            min_samples_leaf=15,
            random_state=SEED,
            n_jobs=-1,
        )
        model.fit(X, y)
        _MODEL = model
    return _MODEL


# ------------------------------------------------------------------ features


def build_feature_frame(db, df_readings: pd.DataFrame,
                        alert_counts: dict[str, int] | None = None
                        ) -> pd.DataFrame:
    """One row per equipment id with the features the model needs."""
    from sqlalchemy import text

    alert_counts = alert_counts or {}

    equipment = pd.read_sql(text("SELECT * FROM equipment"), db.connection())
    if equipment.empty:
        return pd.DataFrame(columns=["id", *FEATURES])

    today = pd.Timestamp.now().normalize()

    # days since the last maintenance entry per asset
    maint = pd.read_sql(
        text("SELECT equipment_id, MAX(date) AS last_date, "
             "COUNT(*) FILTER (WHERE action = 'repair') AS repairs "
             "FROM maintenance_log GROUP BY equipment_id"),
        db.connection(),
    )
    last_service = dict(zip(maint["equipment_id"], maint["last_date"])) if not maint.empty else {}
    repairs = dict(zip(maint["equipment_id"], maint["repairs"])) if not maint.empty else {}

    # repairs in the last 180 days
    # bound parameter instead of INTERVAL so this runs on Postgres and SQLite
    recent = pd.read_sql(
        text("SELECT equipment_id, COUNT(*) AS n FROM maintenance_log "
             "WHERE action = 'repair' AND date >= :cutoff "
             "GROUP BY equipment_id"),
        db.connection(),
        params={"cutoff": (today - pd.Timedelta(days=180)).date()},
    )
    failures_180 = dict(zip(recent["equipment_id"], recent["n"])) if not recent.empty else {}

    # current power per equipment
    power_now: dict[str, float] = {}
    if not df_readings.empty:
        eq_power = df_readings[(df_readings["metric"] == "power_kw")
                               & (df_readings["entity_id"].str.startswith("EQ-"))]
        if not eq_power.empty:
            latest = eq_power.sort_values("ts").groupby("entity_id").tail(1)
            power_now = dict(zip(latest["entity_id"], latest["value"].astype(float)))

    rows = []
    for _, eq in equipment.iterrows():
        eid = eq["id"]

        install = pd.to_datetime(eq["install_date"], errors="coerce")
        age_days = float((today - install).days) if pd.notna(install) else 730.0
        age_days = max(age_days, 0.0)

        last = pd.to_datetime(last_service.get(eid), errors="coerce")
        since = float((today - last).days) if pd.notna(last) else 365.0

        warranty = pd.to_datetime(eq["warranty_until"], errors="coerce")
        warranty_left = float((warranty - today).days) if pd.notna(warranty) else -999.0

        rated = float(eq["rated_kw"] or 0.0)
        load_ratio = (power_now.get(eid, 0.0) / rated) if rated > 0 else 0.0

        rows.append({
            "id": eid,
            "name": eq["name"],
            "criticality": eq["criticality"],
            "replacement_cost": int(eq["replacement_cost"] or 0),
            "age_days": age_days,
            "days_since_service": since,
            "failures_180d": float(failures_180.get(eid, 0)),
            "anomalies_7d": float(alert_counts.get(eid, 0)),
            "load_ratio": float(np.clip(load_ratio, 0.0, 3.0)),
            "warranty_days_left": warranty_left,
            "criticality_score": float(CRITICALITY_SCORE.get(eq["criticality"], 1)),
            "repairs_total": float(repairs.get(eid, 0)),
        })

    return pd.DataFrame(rows)


# ------------------------------------------------------------------ prediction


def _reasons(row: pd.Series) -> list[str]:
    """Top drivers in words a technician would use."""
    reasons: list[tuple[float, str]] = []

    if row["anomalies_7d"] >= 2:
        reasons.append((2.0 * row["anomalies_7d"],
                        f"{int(row['anomalies_7d'])} anomalies in the last 7 days"))
    if row["failures_180d"] >= 2:
        reasons.append((1.5 * row["failures_180d"],
                        f"{int(row['failures_180d'])} repairs in the last 6 months"))
    if row["load_ratio"] > 1.0:
        reasons.append((2.0,
                        f"Drawing {row['load_ratio'] * 100:.0f}% of its rated load"))
    if row["days_since_service"] > 180:
        reasons.append((1.2, f"No service for {int(row['days_since_service'])} days"))
    if 0 <= row["warranty_days_left"] <= 60:
        reasons.append((1.4, f"Warranty ends in {int(row['warranty_days_left'])} days"))
    if row["age_days"] > 2000:
        reasons.append((1.0, f"{row['age_days'] / 365:.0f} years old"))

    reasons.sort(key=lambda pair: pair[0], reverse=True)
    picked = [text for _, text in reasons[:3]]
    return picked or ["No strong signals — routine monitoring"]


def predict_all(db, df_readings: pd.DataFrame,
                alert_counts: dict[str, int] | None = None) -> pd.DataFrame:
    """Risk + days_to_failure + reasons for every asset.

    `risk` is a 0..1 score meaning "how bad is this asset relative to the rest
    of campus". The forest's raw probability is too compressed to read off a
    dashboard (everything lands near 0.7), so it is blended with the asset's
    percentile rank. That keeps the ordering the model learned while spreading
    the numbers across the full 0..1 range.
    """
    frame = build_feature_frame(db, df_readings, alert_counts)
    if frame.empty:
        return frame

    model = train()
    X = frame[FEATURES].to_numpy(dtype=float)
    raw = model.predict_proba(X)[:, 1]

    n = len(frame)
    rank = pd.Series(raw).rank(method="average").to_numpy() / max(n, 1)
    blended = 0.6 * raw + 0.4 * rank
    frame["risk"] = np.round(np.clip(blended, 0.0, 0.99), 3)

    # risk 1.0 -> about 3 days out, risk 0.0 -> beyond the horizon
    frame["days_to_failure"] = np.where(
        frame["risk"] <= 0.10,
        365,
        np.clip(np.round(3 + (1 - frame["risk"]) ** 1.6 * 120), 3, 365),
    ).astype(int)

    frame["reasons"] = frame.apply(_reasons, axis=1)
    return frame.sort_values("risk", ascending=False).reset_index(drop=True)


def to_prediction_rows(predictions: pd.DataFrame) -> list[dict]:
    """Shape rows for an UPSERT into `predictions`."""
    return [
        {
            "equipment_id": row.id,
            "risk": float(row.risk),
            "days_to_failure": int(row.days_to_failure),
            "reasons": list(row.reasons),
        }
        for row in predictions.itertuples(index=False)
    ]
