# H4 · Insights (ranking + what-if), reports, CSV import, polish (Harshavi · ~60 min)

**Read first:** `docs/AI_RULES.md`, `docs/contract/api.md` (Insights + import).

## Build
1. **Insights page:**
   - **Ranked interventions** table: rank, title, risk, downtime, cost, ₹ savings/month, **payback period**, and a "why" tooltip.
   - **What-if simulator:** toggles/sliders (LED retrofit, AC setpoint 22→26 °C, close building after X pm, replace equipment). On change → `POST /api/insights/whatif` → show before/after cards (₹/month, kWh, CO₂) and pass `per_building` to `<Campus3D whatIf=…>` so the campus recolors. Clearly label "Simulated scenario".
2. **Reports page:** Sustainability (kWh, water, CO₂, cost, vs last period, score, "≈ N trees") and Asset health (A–F grades per building, worst assets). **Download PDF** via a print stylesheet + `window.print()` (simplest). Footer: "Synthetic data · tariff ₹9/kWh assumed · emission factor assumed".
3. **Import page:** drag-and-drop CSV → `POST /api/import/csv?commit=false` → show row counts, error list, preview → "Import valid rows" (`commit=true`).
4. **Polish pass:** loading skeletons, empty states, consistent spacing, favicon/title, responsive check, no console errors. Check the demo flow end to end (see `BUILD_PLAN.md`).
5. If Rishi's 3D is struggling at the T+2:00 checkpoint, help him decide on the 2D fallback; the props stay the same.

## Done when
- [ ] What-if changes numbers *and* the campus colors
- [ ] Report prints to a clean PDF

**Commit:** `frontend: insights, reports, import, polish` · **Then:** `docs/tasks/ALL_final_hour.md`
