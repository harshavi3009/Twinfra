# CLAUDE.md · campus3d (Rishi's folder)

You are working with **Rishi** on the 3D campus. Follow `docs/AI_RULES.md`.

- **Only create/edit files inside `frontend/src/campus3d/`.** Everything else in `frontend/` belongs to Harshavi.
- Need a new npm package or a change outside this folder (e.g. how the parent passes props)? Don't do it. Write the exact request for Rishi to send Harshavi.
- Export `Campus3D` from `index.jsx` with exactly the props in `docs/contract/api.md` (section "Frontend ↔ 3D component"). Data shapes come from the same file (`/api/campus`, `/api/buildings/{id}`).
- Build against Harshavi's mock JSON in `frontend/src/mocks/` until the backend is live.
- Stack: three.js via `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing` (already installed).
- Keep it smooth: watch FPS on a normal laptop, reuse geometries/materials, avoid huge shadow maps.
- Tasks in order: `docs/tasks/rishi/R1_static_campus.md` → `R2_drilldown_interaction.md` → `R3_flows_whatif_effects.md`. Respect the T+2:00 checkpoint in R2.
