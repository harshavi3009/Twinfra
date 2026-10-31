"""Create every table from contract/db.md.

Run:  python -m app.create_tables
Safe to re-run: create_all only creates what's missing.
"""

from sqlalchemy import text

from . import models  # noqa: F401  - import registers all tables on Base.metadata
from .db import Base, engine
from .tickets.ids import ensure_sequences


def create_tables() -> None:
    Base.metadata.create_all(bind=engine)
    # Explicit index from contract/db.md (also declared on the model).
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_readings_entity_metric_ts "
                "ON readings (entity_id, metric, ts)"
            )
        )
        # POST /api/readings upserts instead of blind-inserting, so replaying an
        # hour of simulator data is safe. ON CONFLICT needs this unique key.
        # If duplicate rows already exist (older seeds did insert freely), we
        # de-duplicate first, keeping the newest value for each key.
        dupes = conn.execute(
            text(
                "SELECT 1 FROM readings GROUP BY entity_id, metric, ts "
                "HAVING count(*) > 1 LIMIT 1"
            )
        ).first()
        if dupes:
            print("  deduplicating readings (keeping newest per entity/metric/ts)...")
            conn.execute(
                text(
                    "DELETE FROM readings a USING readings b "
                    "WHERE a.entity_id = b.entity_id AND a.metric = b.metric "
                    "AND a.ts = b.ts AND a.id < b.id"
                )
            )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_readings_entity_metric_ts "
                "ON readings (entity_id, metric, ts)"
            )
        )
    ensure_sequences()

    print(f"created/verified {len(Base.metadata.tables)} tables:")
    for name in sorted(Base.metadata.tables):
        print(f"  - {name}")


if __name__ == "__main__":
    create_tables()
