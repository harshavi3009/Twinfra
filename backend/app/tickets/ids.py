"""Ticket id generation.

`TK-0001`, `TK-0002`, ... backed by a real Postgres sequence so two concurrent
writers (Aditya's auto-ticket from the detection loop, a manual ticket from the
UI) can never collide. Do not use max(id)+1 anywhere.

Ranges:
  TK-0001 .. TK-8999   normal tickets
  TK-9001 .. TK-9999   reserved for auto-generated tickets (easy to spot in a demo)
"""

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import engine

AUTO_PREFIX = 9000


def ensure_sequences() -> None:
    """Create the sequences if missing. Idempotent; runs at startup."""
    with engine.begin() as conn:
        conn.execute(text("CREATE SEQUENCE IF NOT EXISTS ticket_id_seq START WITH 1"))
        conn.execute(text("CREATE SEQUENCE IF NOT EXISTS ticket_auto_id_seq START WITH 1"))


def next_ticket_id(db: Session, auto: bool = False) -> str:
    """Atomically reserve the next ticket id.

    auto=True returns from the 9xxx block reserved for machine-created tickets.
    """
    seq = "ticket_auto_id_seq" if auto else "ticket_id_seq"
    n = int(db.execute(text(f"SELECT nextval('{seq}')")).scalar_one())
    return f"TK-{AUTO_PREFIX + n if auto else n:04d}"
