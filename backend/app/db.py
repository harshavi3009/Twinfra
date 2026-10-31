"""Engine + session for PostgreSQL.

Everyone (Ayaan's routers, Aditya's ml/ + insights/ code) shares this session
factory so nobody hand-writes connection strings.
"""

import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# backend/.env, regardless of the cwd the app was started from
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Copy backend/.env.example to backend/.env and fill it in."
    )

# Supabase requires SSL; local Postgres usually doesn't have it.
connect_args = {}
if "supabase" in DATABASE_URL or "sslmode=" in DATABASE_URL:
    connect_args = {"sslmode": "require"}

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,   # survives Supabase idle-connection drops
    pool_size=5,
    max_overflow=5,
    connect_args=connect_args,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency: yields a session and always closes it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
