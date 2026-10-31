# backend · Twinfra (Campus Digital Twin)

FastAPI + SQLAlchemy + PostgreSQL. Owner: **Ayaan** (everything except `app/insights/`, which is Aditya's).
Contract: `contract/api.md` (JSON shapes) · `contract/db.md` (tables).

---

## 1. One-time setup (Windows PowerShell)

```powershell
cd Twinfra\backend

# virtualenv
python -m venv venv
.\venv\Scripts\Activate.ps1
# if that errors with "running scripts is disabled":
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

pip install -r requirements.txt

# env file
Copy-Item .env.example .env
notepad .env      # paste the real DATABASE_URL, save, close
```

`.env` is git-ignored. **Never commit it.** Share the `DATABASE_URL` privately with the team (WhatsApp/DM), not in the repo or PR.

### Database: Supabase (session pooler)

Supabase → your project → **Connect** → **Session pooler** → copy the URI and swap in your password:

```
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Use **session pooler** (port 5432), not the direct connection — the direct host is IPv6-only on the free tier and will time out on many Windows/LAN setups. `db.py` auto-adds `sslmode=require` when the URL contains `supabase`.

### Fallback: Postgres on a Linux box

```
DATABASE_URL=postgresql://twinfra:<password>@<lan-ip>:5432/twinfra
```

Make sure `listen_addresses = '*'` and `pg_hba.conf` allows the LAN subnet. Same code path — nothing to change.

---

## 2. Create tables + seed

```powershell
python -m app.create_tables
python -m app.seed
```

Expected output:

```
created/verified 11 tables
campus: 6 buildings, 17 floors, 94 rooms, 233 equipment
technicians: 5
readings: 576 rows (24h of 15-min data for 6 buildings)
done.
```

`create_all` only creates what's missing, and `seed` upserts by id — both are safe to re-run.

Useful flags:

| Command | Effect |
|---|---|
| `python -m app.seed --from-csv` | also loads Aditya's CSVs from `data/` |
| `python -m app.seed --no-readings` | structure + workforce only |
| `python -m app.seed --reset` | wipe tickets/alerts/predictions first (demo reset) |

---

## 3. Run the API

```powershell
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- Swagger: <http://localhost:8000/docs>
- Health: <http://localhost:8000/api/health> → `{"ok": true}`
- DB check: <http://localhost:8000/api/health/db> → `{"ok": true, "tables": [...], "count": 11}`
- Uploads: <http://localhost:8000/uploads/> (technician photos)

`--host 0.0.0.0` is what lets a phone on the venue Wi-Fi reach the API at `http://<your-lan-ip>:8000`.

Find your LAN IP: `ipconfig` → *IPv4 Address* (e.g. `192.168.1.42`). Point the frontend at it with `VITE_API_URL=http://192.168.1.42:8000`.

---

## 3b. How to run the demo (exact order)

This is the start-up order for the demo machine. Each step depends on the one above it, so don't reorder.

```bash
# 0. one shell, from backend/, venv active, .env filled in
#    check: python -c "import app.db; print('db config ok')"

# 1. DATABASE - Supabase is already running; nothing to start.
#    For the local fallback: pg_ctl -D <datadir> -l <log> start
#    verify: curl localhost:8000/api/health/db  (after step 3)

# 2. TABLES + DATA (idempotent - safe to re-run)
python -m app.create_tables
python -m app.seed                 # add --reset for a clean slate on stage

# 3. API
uvicorn app.main:app --host 0.0.0.0 --port 8000
#    verify: curl localhost:8000/api/health   -> {"ok": true}

# 4. INSIGHTS (Aditya) - populates alerts + predictions + failure risk
curl -X POST localhost:8000/api/insights/run
#    Do this BEFORE the demo, not during it. Until it runs, `predictions` is
#    empty and the failure-prediction cards are blank.

# 5. SIMULATOR (Aditya) - writes live readings
#    python -m ml.simulator   (or whatever the current entrypoint is)

# 6. FRONTEND
cd ../frontend && npm run dev
#    set VITE_API_URL=http://<LAN-IP>:8000 if demoing from a phone
```

**Demo-machine checklist**

| Check | How |
|---|---|
| DB reachable | `curl localhost:8000/api/health/db` → `"count": 11` |
| Alerts exist | `curl localhost:8000/api/insights/alerts` → non-empty |
| Predictions exist | `curl localhost:8000/api/equipment/EQ-0001` → `prediction` not null |
| Tickets exist | `curl localhost:8000/api/tickets` → non-empty |
| Phone can reach it | open `http://<LAN-IP>:8000/api/health` on the phone |
| Fast enough | `curl -w '%{time_total}\n' localhost:8000/api/campus` → well under 0.5s |

**If the API feels slow:** responses are cached for 10 s with stale-while-revalidate (`app/cache.py`), because one Supabase pooler round trip costs 340–1500 ms and `/api/campus` makes four of them. Measured here: **3.8 s cold → 2 ms warm**. The cache is invalidated on every write, so ticket creation still shows up immediately. If you ever need strictly fresh reads, set `STALE_WHILE_REVALIDATE = False` in `app/cache.py`.

---

## 4. Layout

```
backend/
  app/
    main.py          CORS, /uploads mount, router registration
    db.py            engine + SessionLocal + get_db  (Aditya imports this)
    models.py        every table from contract/db.md
    create_tables.py create_all + readings index
    seed.py          pinned campus B1-B6 + technicians + hand-made readings
    routers/
      health.py      /api/health, /api/health/db
      ...            campus, assets, readings, tickets, imports   (task A2, A3)
    insights/        ADITYA'S - /api/insights/* + clear_fault()
  requirements.txt
  .env.example
```

### Notes for teammates

- **Aditya:** `from app.db import SessionLocal`, `from app.models import Reading, Alert, Prediction`. `clear_fault(entity_id)` in `app/insights/router.py` is the hook the tickets flow will call. `app.seed.build_universe()` gives you the exact same entity ids the DB uses — import it so the generator and seed can't drift.
- **Frontend:** `http://localhost:8000/api/...`. CORS is open in dev.
- **One contract change (add-only):** `readings.baseline` (`double precision`, nullable). `api.md` requires a per-point `baseline` and a `{low, high}` band, but `db.md` has no place to store it. Column added; no existing table/column changed.

---

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| `RuntimeError: DATABASE_URL is not set` | you're missing `backend/.env` — copy `.env.example` |
| `password authentication failed` | password from Supabase, and `<project-ref>` must be in the username (`postgres.abcdefgh`) |
| `could not translate host name` / connection timeout | you copied the **direct** host, not the **session pooler** |
| `Activate.ps1 cannot be loaded` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, reopen PowerShell |
| Swagger opens but `/api/health/db` 500s | tables don't exist yet → `python -m app.create_tables` |
| `ModuleNotFoundError: app` | run from `backend/`, not from the repo root |
