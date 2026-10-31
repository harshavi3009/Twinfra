# Hand gestures for the 3D campus

Optional camera control for the campus view. **Off by default** — the demo works
entirely with the mouse if the webcam or the venue lighting fails.

## The pipeline

```
 webcam frame
      │
      ▼
 [1] handTracker.js ──► 21 landmarks per hand      "where is the hand"
      │                ([x,y] in 0..1, mirrored)
      ▼
 [2] classify.js ─────► "open" | "fist" | "pinch"  "what is the hand doing"
      │                 pure functions, no DOM
      ▼
 [3] GestureController.js ──► ("orbit", [dx,dy])   "what should the model do"
      │                       pure functions, injectable clock
      ▼
 [4] GestureCameraBridge.jsx ──► OrbitControls     "do it"
```

Stages 2 and 3 are pure and covered by tests. Stage 4 is the only one that
touches React Three Fiber.

## Gestures

| Gesture | Action |
|---|---|
| **Open palm**, move | orbit / rotate the campus |
| **Fist**, drag | pan |
| **Pinch** (thumb + index) | select the building under the fingertip |
| **Two hands** apart / together | zoom out / in |
| **Peace** — hold 0.8 s | toggle exploded floors |
| **Thumbs up** — hold 0.8 s | toggle x-ray |
| **Call** (thumb + pinky) — hold | toggle labels |

## Why the classifier needs no training

MediaPipe hands you 21 fixed landmarks. A finger is extended when its tip is
further from the wrist than its middle joint is:

```js
distance(wrist, tip) > distance(wrist, middleJoint) * 1.08
```

Count the extended ones and you have the gesture. Everything is measured
**relative to hand size**, never in pixels — that is why it keeps working when
you step back from the camera.

## Why the behaviour layer matters more than the classifier

Recognising a gesture is easy; not annoying the presenter is hard. The
controller handles:

- **smoothing** — an exponential filter on palm position, so a shaky hand does
  not shake the camera
- **dead zone** — movement below a threshold emits nothing
- **stability** — a gesture must hold for 3 frames before it counts, so one bad
  frame cannot fire an action
- **hold + cooldown** — a toggle fires once per hold, then locks out for 1.3 s.
  Without this, a twitchy peace sign explodes the floors repeatedly
- **reset on hand exit** — the hand leaving frame clears state, so it does not
  jump when it comes back

## Tests

```bash
cd frontend
node --test src/gestures/gestures.test.js
```

18 tests, no camera, no browser. They feed synthetic landmarks and assert exact
commands, including "peace fires exactly once per hold" and "no jump after the
hand reappears".

## The WASM bundle

`public/mediapipe-wasm/` holds the MediaPipe runtime (~29 MB) so nothing is
fetched from a CDN at demo time — venue wifi will not reliably pull that down.

`@mediapipe/tasks-vision` is imported **dynamically**, so it is a separate
154 KB chunk that only loads when someone turns hand control on. Normal users
never download it.

## Wiring

`Overview.jsx` owns the toggle and the overlay. `campus3d/index.jsx` gained two
optional props, both defaulting to `null`, so nothing changes for mouse users:

```jsx
<Campus3D
  ...
  gestureCommand={handControl ? commandRef : null}
  onGesturePick={selectEntity}
/>
```

## Known limits

- **Pinch-to-select** needs `userData={{ entityId: id }}` on a building group.
  Until Rishi adds it, `onPick` receives `{position}` instead of an id, so the
  selection does not resolve. Camera gestures are unaffected.
- **X-ray / labels / walkthrough** commands are emitted by the controller but
  nothing consumes them yet — R3 did not build those toggles. Wiring them is a
  small follow-up once the props exist.
- Detection runs at 15 fps on its own timer, not in the render loop, so the 3D
  scene keeps its frame budget.
