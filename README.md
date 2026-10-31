# CampusTwin

A digital twin of a university campus. CampusTwin combines a 3D model of the campus, live building telemetry, anomaly detection, maintenance tickets and sustainability reporting in one dashboard, so facility teams can see problems on the map and act on them.

Built for HackNova 2026, problem statement PS12 (Campus Digital Twin). All campus data in this project is synthetic and labelled as such in the interface.

**Live demo:** https://frontend-eight-lilac-13.vercel.app

---

## What it does

| Area | Capability |
|---|---|
| **3D campus** | Interactive model of six buildings with floors, rooms and equipment. Click to drill from campus to building, floor, room and asset. Day and night lighting, utility flow lines, and what-if overlays. |
| **Alerts** | Live anomaly detection for spikes, ghost load (power used in empty rooms), night-time water leaks and drift. Severity drives the colour of each building, room and asset on the map. |
| **Tickets** | Alerts turn into maintenance tickets with SLA countdowns. Technicians are suggested by skill and workload. Completed repairs are verified against the readings afterwards. |
| **Technician view** | A phone-friendly page at `/tech` for field staff to see assigned tickets, upload completion photos and close work. |
| **Insights** | Failure-risk predictions per asset, with the reasons behind each score. |
| **What-if simulator** | Compare LED retrofit, AC scheduling, ghost-load removal and solar options against the current baseline. |
| **Reports** | Per-building health grades, sustainability figures (energy and water against baseline), and recommended interventions. |
| **Data import** | Load CSV files for buildings, rooms, equipment and readings. |

## Architecture

```
  React + Vite + three.js ──HTTP──>  FastAPI  ──SQLAlchemy──>  PostgreSQL (Supabase)
  (web dashboard, /tech)             (REST API)                  │
          ▲                              ▲                        │
          │                              │                        │
  Flutter app (Android)       Simulator (ml/simulator.py)  ───────┘
  (read-only staff companion)  streams synthetic readings
```

- **Frontend (`frontend/`):** React 19, React Router, Recharts, react-three-fiber and drei for the 3D campus, Tailwind CSS.
- **Backend (`backend/`):** FastAPI with SQLAlchemy 2 on PostgreSQL. Response caching keeps the dashboard responsive while the simulator writes.
- **Insights (`backend/app/insights/`):** detection, ticket routing, failure prediction (scikit-learn) and repair verification, run as one pipeline.
- **Data and simulation (`data/`, `ml/`):** synthetic campus generator, the live simulator that streams 15-minute readings, and tests for the insights logic.
- **Mobile (`mobile/`):** Flutter companion app for Android. Staff can browse buildings, rooms and alerts, and open the 3D campus in a web view. The app only reads data; verification stays on the campus server.
- **Hand gestures (`frontend/src/gestures/`):** optional webcam control of the 3D campus, described below.

## Features in detail

### 3D campus and interaction

The campus scene is built from the same data as the API, so the map and the lists never disagree. Buildings are coloured by health: green is healthy, amber is a warning and red is critical. Selecting a building opens its floors, selecting a floor shows room heat maps on power use against baseline, and selecting a room lists its equipment with individual status.

Utility flow lines show how the substation and water tank feed the buildings. Choosing a utility highlights the buildings it affects, and the impact analysis flashes the affected rooms.

Day and night modes change the sky, lighting and window glow.

### Hand gesture controls

The 3D campus can be controlled with hand gestures from a webcam. It is off by default, and the mouse works without it.

| Gesture | Action |
|---|---|
| Open palm, move | Orbit the campus |
| Fist, drag | Pan |
| Pinch (thumb and index) | Select the building under the fingertip |
| Two hands apart or together | Zoom out or in |
| Peace sign, hold 0.8 s | Toggle exploded floors |
| Thumbs up, hold 0.8 s | Toggle x-ray view |
| Call sign (thumb and pinky), hold | Toggle labels |

Hand tracking uses MediaPipe Hands running in the browser, so no video leaves the device. Gestures are recognised from the distance between hand landmarks, relative to hand size, so they work at different distances from the camera. Smoothing, a dead zone and a three-frame stability check keep the camera steady.

### Mobile companion app

The Flutter app (`mobile/`, Android) is a read-only companion for campus staff. It has four screens:

- **Campus:** the 3D campus in a web view, with pinch, drag and tap.
- **Buildings:** a native list of buildings, floors and rooms with live power and occupancy.
- **Alerts:** active and past alerts with severity, explanation and linked ticket.
- **Settings:** the API address, a connection test and notification permission.

## Running it locally

You need Python 3.12 or newer, Node.js 20 or newer, and a PostgreSQL database. Supabase works well; the session pooler URL is the one to use.

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows PowerShell: .\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Create `backend/.env` from the template and fill in your database URL:

```bash
cp .env.example .env
```

```
DATABASE_URL=postgresql://<user>:<url-encoded-password>@<pooler-host>:5432/postgres
CORS_ORIGINS=*
UPLOAD_DIR=uploads
```

Create the tables, load the campus, and start the API:

```bash
python -m app.create_tables
python -m app.seed
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The API is at `http://localhost:8000` with interactive docs at `/docs`. `GET /api/health/db` confirms the database connection.

### 2. Frontend

```bash
cd frontend
npm install
```

Create `frontend/.env`:

```
VITE_API_URL=http://localhost:8000
VITE_USE_MOCK=false
```

```bash
npm run dev
```

Open `http://localhost:5173`. Set `VITE_USE_MOCK=true` to run the dashboard without a backend, using the bundled sample data.

### 3. Live data (optional)

The simulator streams synthetic readings into the database, so the alerts and maps keep moving:

```bash
python ml/simulator.py
```

Run one simulator at a time. The database pooler allows a limited number of connections.

### 4. Mobile app (optional)

```bash
cd mobile
flutter pub get
flutter build apk --debug
```

Set the API address in the app's Settings screen. For a phone on the same Wi-Fi, use `http://<laptop-ip>:8000`. Over USB, `adb reverse tcp:8000 tcp:8000` lets the phone use `http://127.0.0.1:8000`.

## Deployment

The web dashboard is deployed to Vercel from `frontend/`. The API needs a long-running host, because it holds injected-fault state in memory and serves uploaded photos from disk. The configuration is:

| Setting | Value |
|---|---|
| Frontend `VITE_API_URL` | Public URL of the API |
| Frontend `VITE_USE_MOCK` | `false` for live data, `true` for the bundled sample |
| Backend `DATABASE_URL` | Supabase session pooler URL |
| Backend `CORS_ORIGINS` | The Vercel domain |

## Repository layout

```
backend/     FastAPI app, database models, insights pipeline
frontend/    React dashboard, 3D campus, gesture controls
mobile/      Flutter companion app (Android)
ml/          Synthetic data generator, live simulator, insight tests
data/        Synthetic campus CSVs (buildings, rooms, equipment, readings)
docs/        API and database contracts
```

API endpoints and table definitions are in `docs/contract/api.md` and `docs/contract/db.md`.

## Team

| Member | Responsibility |
|---|---|
| Harshavi | Web dashboard, alerts, tickets, technician view, reports, deployment |
| Rishi | 3D campus, drill-down, flows, what-if effects |
| Ayaan | Backend API, database, Flutter companion app |
| Aditya | Insights and ML (anomaly detection, predictions), simulator, gesture controls |

## Data and disclaimers

All campus data (buildings, rooms, equipment, readings, technicians, tickets) is synthetic. Tariffs and emission factors are assumptions used to estimate savings and are labelled as such. Alerts marked as demo entries are pre-configured so the alert and ticket flow can be shown on every run.
