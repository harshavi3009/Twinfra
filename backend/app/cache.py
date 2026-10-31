"""Tiny TTL cache for read endpoints.

Why this exists: the demo runs against Supabase's free-tier pooler, where a
bare ``SELECT 1`` measures 340-1100 ms regardless of query content. Perf work
on the SQL does not help - the round trip is the floor, so the only lever is
*how many round trips a request makes*, and caching makes it zero.

Budgets (A4: ``/api/campus`` well under 500 ms):
    campus       4 queries x ~450 ms = ~1.8 s  -> served from cache in <1 ms
    buildings/N  5 queries           = ~2.5 s  -> ditto

A short TTL is fine for the demo because readings arrive in hourly batches; a
one-second-old aggregate is indistinguishable from a fresh one on screen. The
cache is dropped explicitly on writes where staleness would be visible (see
``invalidate()``), so ticket creation still shows up immediately.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable, Hashable

# Default freshness window. Longer = faster, staler.
#
# Measured against Supabase's pooler from this machine: a bare ``SELECT 1``
# costs 340-1500 ms and worsens under load, so /api/campus (4 queries) takes
# ~1.7-4 s cold. A TTL shorter than the producer time means the entry expires
# before it finishes being useful and every request becomes a miss - so these
# are set well above it. 10 s is invisible on screen: readings arrive hourly,
# and staleness on *writes* is handled by invalidate() instead of by the clock.
DEFAULT_TTL = 10.0

_lock = threading.Lock()
_store: dict[Hashable, tuple[float, Any]] = {}
# one lock per cache key, so a slow endpoint only blocks requests for itself
_key_locks: dict[Hashable, threading.Lock] = {}
_refreshing: set[Hashable] = set()

# Serve an expired value immediately and refetch in the background. Set False to
# make expiry synchronous again (useful if a test wants strict read-after-write).
STALE_WHILE_REVALIDATE = True

# Sentinel: producer may legitimately return None, so a separate marker is
# needed to mean "the refresh failed, keep what we have".
_MISS = object()


def get_or_set(key: Hashable, producer: Callable[[], Any], ttl: float = DEFAULT_TTL) -> Any:
    """Return the cached value for ``key``, else call ``producer`` and store it.

    A per-key lock collapses the thundering herd: when a popular key expires and
    N requests arrive at once, one of them runs ``producer`` and the rest wait
    for its result instead of all firing the same 4-query round trip. Measured
    without this, a single expiry produced a ~6 s p95 against Supabase.

    Crucially the lock is per key, not global, and it is released before the
    value is re-read - so a slow endpoint can never block a different one.
    """
    now = time.monotonic()
    with _lock:
        hit = _store.get(key)
        if hit is not None and hit[0] > now:
            return hit[1]
        key_lock = _key_locks.setdefault(key, threading.Lock())

    with key_lock:
        # another thread may have filled it while we waited
        with _lock:
            hit = _store.get(key)
            if hit is not None and hit[0] > time.monotonic():
                return hit[1]

        # Stale-while-revalidate: if we hold a value that has merely expired,
        # hand it back immediately and refresh in the background. A page load
        # never waits on a ~2 s pooler round trip, and the next request is warm.
        # This is what keeps /api/campus flat instead of spiking every TTL.
        if hit is not None and STALE_WHILE_REVALIDATE:
            _refresh_async(key, producer, ttl)
            return hit[1]

        value = producer()

        with _lock:
            _store[key] = (time.monotonic() + ttl, value)
        return value


def _refresh_async(key: Hashable, producer: Callable[[], Any], ttl: float) -> None:
    """Recompute ``key`` on a daemon thread, once at a time per key.

    Guarded by ``_refreshing`` rather than the key lock so the caller (and every
    other request for this key) returns instantly with the stale value while a
    single background thread does the work.
    """
    with _lock:
        if key in _refreshing:
            return
        _refreshing.add(key)

    def run() -> None:
        try:
            value = producer()
        except Exception:
            # Keep serving the stale copy; a transient pooler error must not
            # blank the dashboard mid-demo.
            value = _MISS
        finally:
            with _lock:
                _refreshing.discard(key)
        if value is not _MISS:
            with _lock:
                _store[key] = (time.monotonic() + ttl, value)

    threading.Thread(target=run, name="cache-refresh", daemon=True).start()


def _stale(key: Hashable) -> tuple[bool, Any]:
    """(has_any_value, value) ignoring expiry."""
    with _lock:
        hit = _store.get(key)
    return (hit is not None, hit[1] if hit else None)


def invalidate(prefix: Hashable | None = None) -> None:
    """Drop one key, all keys starting with ``prefix``, or everything.

    Call after a write so the demo never shows a stale ticket count.
    """
    with _lock:
        if prefix is None:
            _store.clear()
            return
        for k in [k for k in _store if isinstance(k, tuple) and k and k[0] == prefix]:
            _store.pop(k, None)
        _store.pop(prefix, None)


def _reset_locks() -> None:
    """Test helper: drop cached key locks so tests do not leak threads."""
    with _lock:
        _key_locks.clear()
        _refreshing.clear()


def clear_all() -> None:
    with _lock:
        _store.clear()


def cached(namespace: str, ttl: float = DEFAULT_TTL):
    """Cache a whole endpoint handler keyed on ``namespace`` + its arguments.

    Applied to the four read endpoints that dominate the demo. The decorator
    sits *under* FastAPI's routing, so it sees the plain arguments - including
    the ``Session``, which is deliberately excluded from the key (every request
    gets a fresh one, and including it would make every key unique and the cache
    useless).

    Only use on handlers that take no request-specific state beyond their
    path/query arguments and a DB session.
    """
    import functools

    def decorate(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            key = (namespace,) + tuple(
                sorted(
                    (k, v)
                    for k, v in kwargs.items()
                    if k != "db" and isinstance(v, (str, int, float, bool, type(None)))
                )
            ) + tuple(a for a in args if isinstance(a, (str, int, float)))

            # The producer may run on a background thread (stale-while-
            # revalidate). A SQLAlchemy Session is NOT thread-safe, so it must
            # never be the request's — reusing it raised IllegalStateChangeError
            # as soon as a refresh overlapped a request. Every invocation
            # therefore gets a session born on the thread that uses it.
            def produce():
                from .db import SessionLocal

                db = SessionLocal()
                try:
                    return fn(*args, **kwargs, db=db)
                finally:
                    db.close()

            return get_or_set(key, produce, ttl)

        # Hide the wrapped function's signature from FastAPI. Without this,
        # FastAPI still sees the original ``db: Session = Depends(get_db)``
        # parameter and injects a request-scoped session, defeating the whole
        # point of producing on a background thread. Rebuilding the signature
        # without ``db`` means the dependency is never resolved for these
        # routes at all.
        import inspect

        sig = inspect.signature(fn)
        wrapper.__signature__ = sig.replace(
            parameters=[p for p in sig.parameters.values() if p.name != "db"]
        )
        return wrapper

    return decorate


# --------------------------------------------------------------------------- #
# ASGI middleware
# --------------------------------------------------------------------------- #
# Endpoints that are expensive, read-only, and safe to serve slightly stale.
# Kept as an explicit allowlist rather than "everything GET": /uploads/ serves
# technician photos and /api/health must never be cached, and an allowlist
# makes the blast radius obvious to whoever reads this next.
CACHEABLE_PATHS: tuple[str, ...] = (
    "/api/campus",
    "/api/buildings/",
    "/api/rooms/",
    "/api/equipment/",
    "/api/readings",
    "/api/connections",
    "/api/tickets",
    "/api/technicians",
    "/api/insights/alerts",
    "/api/insights/interventions",
    "/api/insights/reports/",
)


class CacheMiddleware:
    """Response-level cache so endpoints stay fast without touching their code.

    The four core read routes cache internally via ``@cached``, but that was
    only half the demo surface. Aditya's insights/reports routes take 14-27 s
    cold against the Supabase pooler and the frontend calls them directly, so
    the Reports and Insights screens would sit blank on stage.

    ``insights/`` is his code, so rather than edit it this wraps it: any GET
    under ``CACHEABLE_PATHS`` is stored by full path+query for ``ttl`` seconds.
    ``invalidate()`` is shared with the endpoint-level cache, so the writes that
    already clear it (tickets, readings, insights/run) clear this too.
    """

    def __init__(self, app, ttl: float = 30.0) -> None:
        self.app = app
        self.ttl = ttl

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "GET":
            return await self.app(scope, receive, send)

        path = scope["path"]
        if not path.startswith(CACHEABLE_PATHS):
            return await self.app(scope, receive, send)

        key = ("mw", path, scope.get("query_string", b"").decode())

        with _lock:
            hit = _store.get(key)
            if hit is not None and hit[0] > time.monotonic():
                return await _send_cached(send, hit[1])

        # Capture the response as it streams past, then store it.
        captured = {"status": None, "headers": None, "body": bytearray()}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                captured["status"] = message["status"]
                captured["headers"] = message["headers"]
            elif message["type"] == "http.response.body":
                captured["body"].extend(message.get("body", b""))
            await send(message)

        await self.app(scope, receive, send_wrapper)

        # Only cache clean, complete successes - never a 500.
        if captured["status"] == 200:
            with _lock:
                _store[key] = (
                    time.monotonic() + self.ttl,
                    (captured["status"], captured["headers"], bytes(captured["body"])),
                )


async def _send_cached(send, payload) -> None:
    status, headers, body = payload
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body})
