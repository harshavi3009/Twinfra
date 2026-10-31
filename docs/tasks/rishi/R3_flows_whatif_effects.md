# R3 · Energy-flow lines, impact highlight, what-if, day/night (Rishi · ~45 min)

**Read first:** `docs/AI_RULES.md`, `docs/contract/api.md` (`/api/connections`, impact, what-if, Campus3D props).
Only start after R2 is integrated with the real API. Pick items in this order; stop when time's up.

## Build (priority order)
1. **Alert beacons:** a floating, bobbing icon above any building/room with an active alert. Makes faults visible from the overview.
2. **Utility flow lines** from `connections`: substation → buildings (electricity, yellow), tank → buildings (water, blue). Animated dashes moving along the line to show flow. Line speed/thickness can scale with load. This covers the PS's "utility connections" visually.
3. **Impact analysis highlight:** when `highlightIds` is set (from `/api/connections/{id}/impact`), the downstream lines turn red and affected rooms flash. Harshavi will add a "What if this fails?" button that sets it.
4. **What-if mode:** when `whatIf` (per-building `status_after`/`power_kw_after`) is set, recolor buildings to the simulated state and show a small "SIMULATED" tag. Smooth transition so judges see the change.
5. **Day/night** (`timeOfDay` prop): darker sky + lit windows at night. Great for showing ghost load ("why is this lab lit at 11pm?").

## Done when
- [ ] Flow lines animate, impact highlight + what-if visibly change the scene
- [ ] Still smooth on the demo machine

**Commit:** `3d: flows, impact, what-if, day-night` · **Then:** `docs/tasks/ALL_final_hour.md`
