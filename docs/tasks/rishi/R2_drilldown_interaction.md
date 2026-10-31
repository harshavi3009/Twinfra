# R2 · Click-to-drill-down: exploded floors, rooms, equipment (Rishi · ~50 min)

**Read first:** `docs/AI_RULES.md`, `docs/contract/api.md` (`/api/buildings/{id}`, `/api/rooms/{id}`, Campus3D props).

## Goal
The "wow" interaction: click a building → camera flies in → floors float apart → rooms glow by usage → click a room → see its equipment → click equipment → asset card opens (Harshavi's panel).

## Build
1. **Hover:** outline/brighten + cursor pointer.
2. **Click building** → call `onSelect({buildingId})`. Parent passes `buildingDetail` back. Camera **flies** smoothly to frame it (drei `CameraControls` or lerp).
3. **Exploded floors:** selected building's floor slabs animate apart vertically (~6–8 m gaps); other buildings fade to ~20% opacity.
4. **Rooms:** lay rooms out as a grid on each floor slab (by order; no coordinates needed). Color = **heatmap** of `power_kw / baseline_kw` (cool → hot); critical rooms pulse.
5. **Click room** → `onSelect({buildingId, floorId, roomId})`. Show small equipment markers/icons above that room (one per item; type-based shape or icon). Click a marker → `onSelect({..., equipmentId})`.
6. **Back / Esc** → zoom out one level; double-click empty space → reset to campus view.
7. Respect `selection` prop changes from outside (e.g. clicking an alert in the feed should fly the camera there).

## ⚠️ T+2:00 checkpoint
If click + fly + status colors aren't solid by then, freeze the 3D at what works and tell the team. Option: a 2D isometric SVG fallback with the **same props** (simple, quick). Don't sink more than ~2h 15m total into 3D before integration.

## Done when
- [ ] building → floor → room → equipment selection works and syncs with the side panel

**Commit:** `3d: drill-down + exploded floors` · **Next:** R3
