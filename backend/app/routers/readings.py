"""Time-series read/write + CSV import (A2).

GET  /api/readings       - points with baseline + band (contract/api.md)
POST /api/readings       - simulator batch, UPSERT on (entity_id, metric, ts)
POST /api/import/csv     - multipart, ?commit=false previews

The baseline/band maths is Aditya's (insights/common.py) per contract/api.md
("Aditya provides the helper"). This module only calls it.
"""

from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from .. import schemas
from ..db import get_db
from ..cache import invalidate

router = APIRouter(prefix="/api", tags=["readings"])

KNOWN_METRICS = {"power_kw", "water_lpm", "occupancy"}


class ReadingIn(BaseModel):
    ts: datetime
    entity_id: str = Field(..., min_length=1)
    metric: str = Field(..., min_length=1)
    value: float
    baseline: float | None = None


class ReadingsBatch(BaseModel):
    readings: list[ReadingIn]


def _baseline_helpers():
    """Import lazily: insights/ is Aditya's and imports pandas (slow)."""
    try:
        from ..insights.common import band as band_fn, baseline_frame
        return baseline_frame, band_fn
    except Exception:  # pragma: no cover - insights always ships with the app
        return None, None


# --------------------------------------------------------------------------- #
# GET /api/readings
# --------------------------------------------------------------------------- #
@router.get("/readings", response_model=schemas.ReadingsResponse)
def get_readings(
    entity_id: str = Query(..., min_length=1),
    metric: str = Query("power_kw"),
    hours: int = Query(24, ge=1, le=24 * 90),
    db: Session = Depends(get_db),
) -> schemas.ReadingsResponse:
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    rows = db.execute(
        text(
            "SELECT ts, value, baseline FROM readings "
            "WHERE entity_id = :e AND metric = :m AND ts >= :since "
            "ORDER BY ts"
        ),
        {"e": entity_id, "m": metric, "since": since},
    ).fetchall()

    if not rows:
        raise HTTPException(
            status_code=404,
            detail=f"no readings for entity_id={entity_id!r} metric={metric!r} in the last {hours}h",
        )

    points = [
        schemas.ReadingPoint(
            ts=r[0], value=float(r[1]), baseline=None if r[2] is None else float(r[2])
        )
        for r in rows
    ]

    # Prefer a stored baseline; otherwise fall back to the weekday+hour mean.
    if any(p.baseline is None for p in points):
        baseline_frame, _ = _baseline_helpers()
        if baseline_frame is not None:
            import pandas as pd

            df = pd.DataFrame(
                [{"ts": r[0], "entity_id": entity_id, "metric": metric, "value": float(r[1]),
                  "baseline": r[2]} for r in rows]
            )
            try:
                filled = baseline_frame(df)
                for p, b in zip(points, filled["baseline"].tolist(), strict=False):
                    if p.baseline is None and b is not None:
                        p.baseline = round(float(b), 3)
            except Exception:
                pass

    low, high = _compute_band(points, entity_id, metric)
    return schemas.ReadingsResponse(
        entity_id=entity_id,
        metric=metric,
        points=points,
        band=schemas.Band(low=low, high=high),
    )


def _compute_band(points: list[schemas.ReadingPoint], entity_id: str, metric: str) -> tuple[float, float]:
    """Delegate to Aditya's band(); fall back to mean ± 2σ so this never 500s."""
    try:
        import pandas as pd

        from ..insights.common import band as band_fn

        df = pd.DataFrame(
            [{"ts": p.ts, "entity_id": entity_id, "metric": metric, "value": p.value,
              "baseline": p.baseline} for p in points]
        )
        out = band_fn(df, entity_id, metric)
        return float(out["low"]), float(out["high"])
    except Exception:
        vals = [p.value for p in points]
        if len(vals) < 2:
            v = vals[0] if vals else 0.0
            return (round(max(v * 0.9, 0.0), 3), round(v * 1.1, 3))
        mean = sum(vals) / len(vals)
        var = sum((v - mean) ** 2 for v in vals) / len(vals)
        std = var**0.5
        return (round(max(mean - 2 * std, 0.0), 3), round(mean + 2 * std, 3))


def _dedupe(rows: list[dict], errors: list[dict] | None = None) -> list[dict]:
    """Collapse duplicate (entity_id, metric, ts) to one row, last one wins.

    Postgres rejects a batch that touches the same conflict target twice:
    "ON CONFLICT DO UPDATE command cannot affect row a second time". A simulator
    replaying a window, or a CSV with a repeated line, hits this on every run,
    so de-duplication has to happen before the statement is built.

    Last-wins matches `ON CONFLICT DO UPDATE` semantics for two separate
    requests, so a batch gives the same result as sending the rows one by one.
    """
    seen: dict[tuple, dict] = {}
    for row in rows:
        key = (row["entity_id"], row["metric"], row["ts"])
        if key in seen and errors is not None:
                errors.append(
                    {
                        "row": row.get("_row"),
                        "problem": (
                            f"duplicate of earlier row for {key[0]}/{key[1]}/{key[2]}"
                            " - kept the later value"
                        ),
                    }
                )
        seen[key] = row
    return list(seen.values())


def _known_entities(db: Session) -> set[str]:
    """Every entity a reading may point at.

    One query. Used by both the simulator POST and the CSV import so they can't
    drift apart - previously only the CSV path validated entity_id, which let
    the simulator create readings for entities that do not exist.
    """
    rows = db.execute(
        text(
            "SELECT id FROM buildings UNION SELECT id FROM rooms "
            "UNION SELECT id FROM equipment "
            "UNION SELECT 'UT-SUB' UNION SELECT 'UT-TANK'"
        )
    ).fetchall()
    return {r[0] for r in rows}


# --------------------------------------------------------------------------- #
# POST /api/readings  (simulator)
# --------------------------------------------------------------------------- #
@router.post("/readings")
def post_readings(batch: ReadingsBatch, db: Session = Depends(get_db)) -> dict:
    """UPSERT, not blind insert: replaying the current hour is safe.

    Needs ux_readings_entity_metric_ts, created by app.create_tables.
    """
    if not batch.readings:
        return {"inserted": 0, "upserted": 0, "skipped": 0, "errors": []}

    errors: list[dict] = []

    unknown_metrics = sorted({r.metric for r in batch.readings} - KNOWN_METRICS)
    if unknown_metrics:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unknown metric(s) {unknown_metrics}; "
                f"expected one of {sorted(KNOWN_METRICS)}"
            ),
        )

    known = _known_entities(db)
    rows: list[dict] = []
    for i, r in enumerate(batch.readings):
        if r.entity_id not in known:
            errors.append({"row": i, "problem": f"unknown entity_id {r.entity_id}"})
            continue
        rows.append(
            {
                "ts": r.ts,
                "entity_id": r.entity_id,
                "metric": r.metric,
                "value": r.value,
                "baseline": r.baseline,
                "source": "sim",
                "_row": i,
            }
        )

    # Unknown entities are reported, not fatal: one bad row in a simulator
    # batch must not discard the 200 good ones.
    rows = _dedupe(rows, errors)
    if not rows:
        return {"inserted": 0, "upserted": 0, "skipped": len(errors) or 0, "errors": errors}

    existing = db.execute(
        text(
            "SELECT count(*) FROM readings WHERE (entity_id, metric, ts) IN ("
            "  SELECT * FROM unnest("
            "    CAST(:ids AS text[]), CAST(:metrics AS text[]), CAST(:tss AS timestamptz[]))"
            ")"
        ),
        {
            "ids": [r["entity_id"] for r in rows],
            "metrics": [r["metric"] for r in rows],
            "tss": [r["ts"] for r in rows],
        },
    ).scalar_one()

    from ..models import Reading

    payload = [{k: v for k, v in r.items() if k != "_row"} for r in rows]
    ins = pg_insert(Reading).values(payload)
    ins = ins.on_conflict_do_update(
        index_elements=["entity_id", "metric", "ts"],
        set_={
            "value": ins.excluded.value,
            "baseline": ins.excluded.baseline,
            "source": ins.excluded.source,
        },
    )
    db.execute(ins)
    db.commit()
    invalidate()

    return {
        "inserted": len(rows) - int(existing),
        "upserted": int(existing),
        "errors": errors[:50],
    }


# --------------------------------------------------------------------------- #
# POST /api/import/csv
# --------------------------------------------------------------------------- #
@router.post("/import/csv")
async def import_csv(
    file: UploadFile = File(...),
    commit: bool = Query(False),
    db: Session = Depends(get_db),
) -> dict:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty file")

    import pandas as pd
    from ..models import Reading

    try:
        df = pd.read_csv(io.BytesIO(raw))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"could not parse CSV: {exc}") from exc

    required = {"ts", "entity_id", "metric", "value"}
    missing = required - set(df.columns)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"missing column(s) {sorted(missing)}; expected {sorted(required)}",
        )

    errors: list[dict] = []
    if "baseline" not in df.columns:
        df["baseline"] = None

    known = _known_entities(db)

    parsed: list[dict] = []
    for i, row in df.iterrows():
        rownum = int(i) + 2  # +1 header, +1 to 1-index
        try:
            ts = pd.to_datetime(row["ts"], utc=True, errors="raise").to_pydatetime()
            value = float(row["value"])
        except Exception as exc:
            errors.append({"row": rownum, "problem": f"bad ts/value: {exc}"})
            continue
        entity_id = str(row["entity_id"]).strip()
        metric = str(row["metric"]).strip()
        if entity_id not in known:
            errors.append({"row": rownum, "problem": f"unknown entity_id {entity_id}"})
            continue
        if metric not in KNOWN_METRICS:
            errors.append({"row": rownum, "problem": f"unknown metric {metric}"})
            continue
        baseline = row["baseline"]
        parsed.append(
            {
                "ts": ts,
                "entity_id": entity_id,
                "metric": metric,
                "value": value,
                "baseline": None if pd.isna(baseline) else float(baseline),
                "source": "csv",
                "_row": rownum,
            }
        )

    parsed = _dedupe(parsed, errors)

    out: dict = {
        "rows": int(len(df)),
        "valid": len(parsed),
        "errors": errors[:50],
        "commit": False,
        "preview": [{k: v for k, v in r.items() if k != "_row"} for r in parsed[:5]],
    }

    if commit and parsed:
        payload = [{k: v for k, v in r.items() if k != "_row"} for r in parsed]
        existing = db.execute(
            text(
                "SELECT count(*) FROM readings WHERE (entity_id, metric, ts) IN ("
                "  SELECT * FROM unnest("
                "    CAST(:ids AS text[]), CAST(:metrics AS text[]), CAST(:tss AS timestamptz[]))"
                ")"
            ),
            {
                "ids": [r["entity_id"] for r in payload],
                "metrics": [r["metric"] for r in payload],
                "tss": [r["ts"] for r in payload],
            },
        ).scalar_one()

        stmt = pg_insert(Reading).values(payload)
        stmt = stmt.on_conflict_do_update(
            index_elements=["entity_id", "metric", "ts"],
            set_={"value": stmt.excluded.value, "baseline": stmt.excluded.baseline,
                  "source": stmt.excluded.source},
        )
        db.execute(stmt)
        db.commit()
        invalidate()
        out["commit"] = True
        # inserted vs updated matters: a re-import should report 0 inserted,
        # not claim it added everything again.
        out["inserted"] = len(payload) - int(existing)
        out["upserted"] = int(existing)

    return out
