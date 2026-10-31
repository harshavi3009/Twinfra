# R1 · Static 3D campus (Rishi · ~40 min)

**Read first:** `docs/AI_RULES.md`, `docs/contract/api.md` (`/api/campus` shape + Campus3D props), `docs/contract/db.md` (default campus table).
**You own only** `frontend/src/campus3d/`. Harshavi already installed `three @react-three/fiber @react-three/drei @react-three/postprocessing`. Need another package? Ask Harshavi to add it (she owns `package.json`).

## Goal
A good-looking, stylized campus rendered from the `campus` prop. Use Harshavi's mock JSON (`src/mocks/`) until the backend is live.

## Build
1. `index.jsx` exports `Campus3D` with the contract props. Split into small files (Building, Floor, UtilityNode, Ground, Effects).
2. **Ground + atmosphere:** dark ground plane, subtle grid or paths between buildings, soft fog, a few low-poly trees (simple cones/spheres).
3. **Buildings** from `campus.buildings`: position/size from data, height = floors × ~4 m, each floor a separate slab (needed for the explode effect in R2) with rows of emissive "windows".
4. **Status colors:** ok green, warning amber, critical red with a **pulsing glow**. Bloom via `@react-three/postprocessing` (keep intensity tasteful).
5. **Labels:** building name + live kW floating above (drei `Html` or `Text`). Small alert badge if `active_alerts > 0`.
6. **Utility nodes:** substation (box with a lightning icon/emissive edges) and water tank (cylinder) from `campus.utilities`.
7. **Camera:** pleasant default angle (isometric-ish), drei `OrbitControls` or `CameraControls`, limits so you can't go under the ground.
8. Smooth status-color transitions when data updates (lerp, no flicker).

## Decide with your human
Style direction (clean minimal vs neon control room) · whether to match the real Govt Polytechnic layout (only if quick; otherwise use the default table).

## Done when
- [ ] Campus renders from mock data, status colors change if you edit the mock
- [ ] Runs smoothly on the gaming PC and a normal laptop (check FPS)

**Commit:** `3d: static campus` · **Next:** R2
