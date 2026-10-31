"""Create every table from contract/db.md.

Run:  python -m app.create_tables
Safe to re-run: create_all only creates what's missing.
"""

from sqlalchemy import text

from .db import Base, engine
from . import models  # noqa: F401  - import registers all tables on Base.metadata


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
    print(f"created/verified {len(Base.metadata.tables)} tables:")
    for name in sorted(Base.metadata.tables):
        print(f"  - {name}")


if __name__ == "__main__":
    create_tables()
