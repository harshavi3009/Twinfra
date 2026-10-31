# H1 · Repo skeleton + frontend shell (Harshavi · ~25 min · DO THIS FIRST, others wait on it)

**Read first:** `docs/AI_RULES.md`, `docs/contract/api.md` (shapes only).

## Goal
Get a pushed repo with folders, a running React app with the full page layout, and a mock-data layer, so Rishi can start the 3D and the frontend can be built before the backend exists.

## Build
1. **Repo skeleton:** folders `frontend/ backend/ ml/ data/ docs/` (docs already exist). Root `.gitignore`: `node_modules/ venv/ .venv/ __pycache__/ .env dist/ backend/uploads/`.
2. **Frontend:** Vite + React (JavaScript is fine; ask human if TypeScript is wanted). Install now, including Rishi's 3D libs, because `package.json` is ours and two people editing it causes conflicts:
   `react-router-dom recharts three @react-three/fiber @react-three/drei @react-three/postprocessing`
   Ask the human whether to add Tailwind (fast styling) or plain CSS.
3. **Visual direction:** dark "campus control room" look. Define color tokens once (bg, panel, border, text, accent, ok `#22c55e`, warning `#f59e0b`, critical `#ef4444`). Pick a distinctive font pair. Ask the human for a product name (working name: CampusTwin).
4. **Layout:** sidebar nav → Overview · Alerts · Tickets · Insights · Reports · Import. Top bar: name, live clock, "● LIVE" indicator, and a small **"Synthetic data"** badge. Route `/tech` renders WITHOUT the sidebar (mobile technician view, built in H3).
5. **API layer** `src/api/client.js`: one function per endpoint in the contract. A `USE_MOCK` flag (env `VITE_USE_MOCK=true`) makes them return files from `src/mocks/` instead of fetching. Write mocks for `/api/campus`, `/api/buildings/B1`, `/api/equipment/EQ-0042`, `/api/insights/alerts`, `/api/tickets`, with **exactly** the contract shapes. Realistic values (6 buildings from `contract/db.md`).
6. **3D placeholder:** create `frontend/src/campus3d/index.jsx` exporting a `Campus3D` that just renders a box saying "3D goes here" and accepts the props listed in the contract. Tell Rishi it now belongs to him.
7. `frontend/.env.example` with `VITE_API_URL=http://localhost:8000` and `VITE_USE_MOCK=true`.

## Decide with your human
TypeScript or not · Tailwind or CSS · product name · accent color.

## Done when
- [ ] `npm run dev` shows the layout with working nav, mock KPI numbers visible somewhere
- [ ] Pushed to GitHub; Rishi, Ayaan and Aditya told to `git pull`

**Commit:** `frontend: scaffold, layout, mock api` · **Next:** H2
