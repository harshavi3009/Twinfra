"""Fix verification (D3).

When a technician marks a ticket done, we do not take their word for it. We
watch the meter.

  1. ticket.completed_at is set
  2. wait out a settle period (the fix needs time to show up in the readings)
  3. give it up to VERIFY_WINDOW_MINUTES
  4. if the readings come back inside the normal band  -> verification = 'verified'
     if they are still outside after the window           -> verification = 'failed'
                                                             and the ticket reopens
     if there is not enough data yet                      -> stay 'pending'

This is what lets the demo say "the repair worked" with evidence instead of a
technician's checkbox.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pandas as pd
from sqlalchemy import text

from .common import baseline_frame, now_utc

SETTLE_SECONDS = 30          # ignore readings this soon after completion
VERIFY_WINDOW_MINUTES = 2    # how long we keep watching before calling it failed
TOLERANCE_MULTIPLIER = 1.5   # "back to normal" = within 1.5x the baseline

_COMPLETED_STATUSES = ("done", "closed")


def _readings_since(db, entity_id: str, since: datetime) -> pd.DataFrame:
    rows = db.execute(text(
        "SELECT ts, entity_id, metric, value FROM readings "
        "WHERE entity_id = :eid AND ts >= :since ORDER BY ts"
    ), {"eid": entity_id, "since": since}).fetchall()
    return pd.DataFrame(rows, columns=["ts", "entity_id", "metric", "value"])


def _baseline_for(db, entity_id: str, metric: str, at: datetime) -> float | None:
    """The normal value for this entity, this metric, this weekday+hour."""
    rows = db.execute(text(
        "SELECT ts, entity_id, metric, value FROM readings "
        "WHERE entity_id = :eid AND metric = :metric "
        "  AND ts < :before "
        "ORDER BY ts DESC LIMIT 500"
    ), {"eid": entity_id, "metric": metric,
        "before": (pd.Timestamp(at) - pd.Timedelta(days=1)).to_pydatetime()}).fetchall()
    if not rows:
        return None

    df = pd.DataFrame(rows, columns=["ts", "entity_id", "metric", "value"])
    frame = baseline_frame(df)
    frame = frame[(frame["weekday"] == at.weekday()) & (frame["hour"] == at.hour)]
    if frame.empty:
        return float(df["value"].mean())
    return float(frame.iloc[0]["mean"])


def _metric_for(db, entity_id: str) -> str:
    """Which metric to watch: water for leaks, power otherwise."""
    row = db.execute(text(
        "SELECT metric FROM alerts WHERE entity_id = :eid "
        "ORDER BY ts DESC LIMIT 1"
    ), {"eid": entity_id}).fetchone()
    if row and row[0]:
        return row[0]
    return "power_kw"


def verify_ticket(db, ticket_id: str) -> dict:
    """Evaluate one completed ticket. Returns what we concluded and why."""
    row = db.execute(text(
        "SELECT id, entity_id, status, completed_at, verification "
        "FROM tickets WHERE id = :id"
    ), {"id": ticket_id}).fetchone()
    if row is None:
        return {"ticket_id": ticket_id, "verification": "none",
                "reason": "ticket not found"}

    entity_id, status, completed_at, current = row[1], row[2], row[3], row[4]

    if status not in _COMPLETED_STATUSES or completed_at is None:
        return {"ticket_id": ticket_id, "verification": current or "none",
                "reason": "ticket is not completed yet"}

    completed_at = pd.Timestamp(completed_at).to_pydatetime()
    now = now_utc()
    elapsed = (now - completed_at).total_seconds()

    if elapsed < SETTLE_SECONDS:
        return {"ticket_id": ticket_id, "verification": "pending",
                "reason": f"settling ({int(elapsed)}s of {SETTLE_SECONDS}s)"}

    metric = _metric_for(db, entity_id)
    reading_rows = _readings_since(db, entity_id, completed_at)
    if reading_rows.empty:
        return {"ticket_id": ticket_id, "verification": "pending",
                "reason": "no readings since completion"}

    baseline = _baseline_for(db, entity_id, metric, now)
    if baseline is None or baseline <= 0:
        return {"ticket_id": ticket_id, "verification": "pending",
                "reason": "no baseline available yet"}

    after = reading_rows[reading_rows["metric"] == metric]
    if after.empty:
        return {"ticket_id": ticket_id, "verification": "pending",
                "reason": f"no {metric} readings since completion"}

    observed = float(after["value"].mean())
    ratio = observed / baseline
    in_band = ratio <= TOLERANCE_MULTIPLIER

    if in_band:
        verdict, note = "verified", (
            f"{metric} back to {observed:.2f} (baseline {baseline:.2f}, "
            f"{ratio:.2f}x) since the repair."
        )
        db.execute(text(
            "UPDATE tickets SET verification = 'verified' WHERE id = :id"
        ), {"id": ticket_id})
    elif elapsed >= VERIFY_WINDOW_MINUTES * 60:
        verdict, note = "failed", (
            f"{metric} still at {observed:.2f} vs baseline {baseline:.2f} "
            f"({ratio:.2f}x) "
            f"{VERIFY_WINDOW_MINUTES} minutes after the repair."
        )
        # reopen: the fix did not take
        db.execute(text(
            "UPDATE tickets SET verification = 'failed', status = 'open', "
            "completed_at = NULL WHERE id = :id"
        ), {"id": ticket_id})
    else:
        return {"ticket_id": ticket_id, "verification": "pending",
                "reason": f"watching ({int(elapsed)}s), "
                          f"{ratio:.2f}x baseline so far"}

    db.commit()
    return {
        "ticket_id": ticket_id,
        "entity_id": entity_id,
        "verification": verdict,
        "observed": round(observed, 3),
        "baseline": round(baseline, 3),
        "ratio": round(ratio, 2),
        "reason": note,
    }


def verify_pending(db) -> list[dict]:
    """Check every completed-but-unverified ticket. Called by the tick loop."""
    rows = db.execute(text(
        "SELECT id FROM tickets "
        "WHERE completed_at IS NOT NULL "
        "  AND (verification IS NULL OR verification IN ('none','pending')) "
        "ORDER BY completed_at LIMIT 50"
    )).fetchall()
    return [verify_ticket(db, row[0]) for row in rows]
