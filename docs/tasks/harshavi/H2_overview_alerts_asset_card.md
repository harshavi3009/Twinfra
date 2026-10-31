# H2 · Overview dashboard, alerts feed, asset card (Harshavi · ~70 min)

**Read first:** `docs/AI_RULES.md`, `docs/contract/api.md` (Core, Insights alerts, Campus3D props).

## Goal
The main demo screen. Judges spend most of the demo here, so it must look alive and make every click feel meaningful.

## Build
1. **KPI strip:** power now vs baseline (with ↑% in red if over), water, occupancy, active alerts, open tickets, and **"₹ wasted this month (est.)"** (sum of `est_cost_inr_month` of active alerts).
2. **Center:** `<Campus3D>` (Rishi's) with `campus`, `selection`, `onSelect`, `buildingDetail`. Keep selection state here. If 3D isn't ready, the placeholder is fine.
3. **Right drill-down panel** that changes with selection:
   - nothing selected → campus summary + top alerts
   - building → floors with rooms list, each colored by status + mini power bar
   - room → equipment list
   - equipment → **asset card**: owner/dept, criticality chip, warranty badge (red if < 30 days, show "Claim under warranty" if a fault is active and warranty valid), maintenance history timeline, **failure prediction** ("likely to fail in ~9 days" + reasons), "Create ticket" button.
4. **Charts** (Recharts) for the selected entity: power vs baseline with the shaded normal band, plus water and occupancy. Mark schedule hours (open/close) on the chart if easy.
5. **Alerts feed:** severity color, plain-English `explanation`, ₹/month cost, link to its ticket, click → selects that entity in 3D.
6. **Live updates:** poll `/api/campus` and alerts every ~3 s (ask human if 5 s is safer). Toast when a new critical alert arrives.
7. **Demo toolbar** (small, collapsible, bottom corner): "Inject fault" → choose entity + kind → `POST /api/insights/sim/fault`. This is how we trigger the demo moment on cue.
8. Alerts page (`/alerts`) = full-page version of the feed with filters (kind, severity, building).

## Decide with your human
Panel layout (right panel vs bottom sheet) · polling rate · how loud the critical toast is.

## Done when
- [ ] Works fully on mocks; switching `VITE_USE_MOCK=false` works once the backend is up (check with Ayaan around T+2:00)
- [ ] Clicking building → room → equipment shows the asset card

**Commit:** `frontend: overview, alerts, asset card` · **Next:** H3
