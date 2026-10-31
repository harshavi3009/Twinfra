"""End-to-end check of the insights pipeline without Postgres.

Runs the real models and the real SQL, against a throwaway SQLite database
seeded from data/*.csv. Postgres-only column types are swapped for SQLite
friends while the models are created, so `models.py` is untouched.

    .venv/bin/python ml/test_insights.py
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "ml"))

# db.py raises if this is unset, so set it before importing anything from app
_DB_PATH = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["DATABASE_URL"] = "sqlite:///" + _DB_PATH

import pandas as pd                                            # noqa: E402
import sqlalchemy                                              # noqa: E402
from sqlalchemy import create_engine, text                     # noqa: E402
from sqlalchemy.dialects import postgresql, sqlite             # noqa: E402
from sqlalchemy.orm import Session                             # noqa: E402

from app import models                                         # noqa: E402
from app.db import Base                                        # noqa: E402

DATA = ROOT / "data"

# --- Postgres types -> SQLite equivalents -------------------------------
postgresql.JSONB = sqlite.JSON
postgresql.ARRAY = sqlite.JSON


def _create_schema(engine) -> None:
    original = {}
    for table in Base.metadata.tables.values():
        for column in table.columns:
            type_ = column.type
            if type_.__class__.__module__.startswith("sqlalchemy.dialects.postgresql"):
                original[id(column)] = type_
                column.type = sqlite.JSON()
    Base.metadata.create_all(engine)
    for table in Base.metadata.tables.values():
        for column in table.columns:
            if id(column) in original:
                column.type = original[id(column)]


def _columns_of(csv_path: Path) -> list[str]:
    return pd.read_csv(csv_path, nrows=0).columns.tolist()


def seed(engine) -> None:
    """Load every CSV whose columns match a table."""
    conn = engine.raw_connection()
    for csv in sorted(DATA.glob("*.csv")):
        name = csv.stem
        table = Base.metadata.tables.get(name)
        if table is None:
            print(f"  skip {csv.name}: no table")
            continue
        header = _columns_of(csv)
        cols = [c for c in header if c in table.columns]
        if not cols:
            continue
        df = pd.read_csv(csv, usecols=cols)
        # CSVs carry their own `id` for connections/readings/maintenance_log;
        # those tables use an autoincrement primary key instead.
        pk = table.columns["id"]
        # integer PKs are generated; string PKs (B1, EQ-0001) come from the CSV
        if "id" in df.columns and isinstance(pk.type, sqlalchemy.Integer):
            df = df.drop(columns=["id"])
            cols = [c for c in cols if c != "id"]
        rows = df[cols].where(pd.notna(df[cols]), None).to_dict("records")
        cursor = conn.cursor()
        cursor.executemany(
            f"INSERT INTO {name} ({', '.join(cols)}) "
            f"VALUES ({', '.join('?' for _ in cols)})",
            [tuple(r[c] for c in cols) for r in rows],
        )
        cursor.close()
        print(f"  loaded {name}: {len(rows)} rows")
    conn.commit()
    conn.close()


def main() -> int:
    engine = create_engine(os.environ["DATABASE_URL"])
    _create_schema(engine)
    seed(engine)

    with Session(engine) as db:
        counts = {
            t: db.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
            for t in ("buildings", "rooms", "equipment", "readings",
                      "maintenance_log", "technicians")
        }
    print("seeded:", counts)

    from app.insights import detect, predict, reporting, tickets, verify

    with Session(engine) as db:
        # ---- detection -------------------------------------------------
        alerts = detect.detect_all(db)
        print(f"\ndetect_all -> {len(alerts)} alerts")
        for a in alerts[:8]:
            print(f"  [{a['severity']:8}] {a['kind']:11} {a['entity_id']:12} "
                  f"{a['actual']:7.2f} vs {a['expected']:6.2f}  ₹{a['est_cost_inr_month']}")

        kinds = {a["kind"] for a in alerts}
        for planted in ("ghost_load", "night_leak", "drift"):
            mark = "found" if planted in kinds else "MISSED"
            print(f"  planted story {planted}: {mark}")

        # ---- full run --------------------------------------------------
        result = reporting.run_all(db)
        print("\nrun_all ->", result)

        stored = reporting.get_alerts(db, active=True)
        print(f"alerts in DB: {len(stored)}")
        if stored:
            print("  sample:", {k: stored[0][k] for k in
                                ("entity_id", "entity_name", "kind", "severity")})

        # ---- tickets ---------------------------------------------------
        with_ticket = [a for a in stored if a["ticket_id"]]
        print(f"alerts linked to a ticket: {len(with_ticket)}")
        ticket_rows = db.execute(text(
            "SELECT id, entity_id, priority, source, status FROM tickets "
            "ORDER BY id LIMIT 5")).fetchall()
        print("  tickets:", ticket_rows)

        # ---- predictions ------------------------------------------------
        preds = db.execute(text(
            "SELECT equipment_id, risk, days_to_failure, reasons FROM predictions "
            "ORDER BY risk DESC LIMIT 5")).fetchall()
        print(f"\npredictions in DB: "
              f"{db.execute(text('SELECT COUNT(*) FROM predictions')).scalar()}")
        for row in preds:
            print(f"  {row[0]} risk={row[1]} d2f={row[2]} {row[3][:2] if isinstance(row[3], list) else row[3][:80]}")

        # ---- verification -----------------------------------------------
        target = ticket_rows[0] if ticket_rows else None
        if target:
            db.execute(text("UPDATE tickets SET status='done', completed_at=:t "
                            "WHERE id=:id"),
                       {"t": (pd.Timestamp.now(tz="UTC")
                              - pd.Timedelta(minutes=5)).to_pydatetime(),
                        "id": target[0]})
            db.commit()
            verdict = verify.verify_ticket(db, target[0])
            print("\nverify (5 min after completion) ->", verdict)

        # ---- D4 ---------------------------------------------------------
        print("\ninterventions:")
        for i in reporting.get_interventions(db)[:5]:
            print(f"  ₹{i['saving_inr_month']:>6}/mo  payback {i['payback_months']}mo  {i['title']}")

        s = reporting.sustainability(db, days=14)
        print("\nsustainability:", {k: s[k] for k in
                                    ("kwh", "co2_kg", "cost_inr", "score",
                                     "trees_equiv", "vs_prev_pct")})

        w = reporting.whatif(db, "led_retrofit")
        print("whatif led_retrofit:", w["saving"])

        h = reporting.asset_health(db)
        print("\nasset_health buildings:", len(h["buildings"]),
              "| worst asset:", h["worst_assets"][0]["equipment_id"] if h["worst_assets"] else None)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
