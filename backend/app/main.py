"""FastAPI entrypoint.

Run:  uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
Docs: http://localhost:8000/docs
"""

import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from .cache import CacheMiddleware  # noqa: E402
from .routers import connections, core, health, readings, technicians, tickets  # noqa: E402
from .insights import router as insights_router  # noqa: E402

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "uploads"))
if not UPLOAD_DIR.is_absolute():
    UPLOAD_DIR = Path(__file__).resolve().parent.parent / UPLOAD_DIR
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="Twinfra · Campus Digital Twin API",
    version="0.1.0",
    description="HackNova 2026 · PS12. All data is synthetic.",
)

# Dev: allow everything (Vite on :5173, LAN IP for the phone demo).
_cors = os.getenv("CORS_ORIGINS", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _cors.strip() == "*" else [o.strip() for o in _cors.split(",")],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Response cache for the expensive read paths. Added after CORS so CORS stays
# outermost (it must add headers to cached responses too). See app/cache.py.
app.add_middleware(CacheMiddleware, ttl=30.0)

# Technician completion photos: /uploads/xyz.jpg
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.include_router(health.router)
app.include_router(core.router)
app.include_router(readings.router)
app.include_router(connections.router)
app.include_router(tickets.router)
app.include_router(technicians.router)
app.include_router(insights_router)

# Must be mounted LAST: a "/" mount catches every path, so mounting it before
# the routers would shadow /api/*. Declared after include_router so /api wins.
# Optional: serve the built React app so the Android WebView can load the 3D
# campus from the same origin as the API. Only active when frontend/dist has
# been built (`npm run build`), so the backend still runs standalone.
_FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if _FRONTEND_DIST.is_dir():
    # html=True makes unknown paths fall through to index.html (SPA routing).
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="frontend")
