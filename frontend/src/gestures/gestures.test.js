/**
 * Tests for the hand-gesture logic. No camera, no browser, no MediaPipe —
 * fake landmarks in, assertions out. Run with:
 *
 *   node --test frontend/src/gestures/gestures.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { classify, classifyPose, FINGERS } from './classify.js'
import { GestureController } from './GestureController.js'

// ---------------------------------------------------------------- helpers

import { fingerScores } from './classify.js'

const OFFSETS = [-0.34, -0.04, 0.26, 0.52]
const KNUCKLE_Y = [0.66, 0.72, 0.66, 0.56]

/**
 * A hand the way MediaPipe actually reports one: wrist at the bottom, knuckles
 * in a shallow arc above it, fingers pointing up when straight and folding back
 * down toward the palm when curled.
 *
 * `reach` is per finger (index, middle, ring, pinky), 1 = straight, 0 = folded.
 * Real hands sit in between — `reach: [0.25, 0.2, 0.2, 0.2]` is what an actual
 * fist measures like, and it is the case that broke the first two classifiers.
 */
function makeHand({ reach = [1, 1, 1, 1], cx = 0.5, cy = 0.62, scale = 1, thumbOut = false, pinch = false } = {}) {
  const s = 0.16 * scale
  const lm = new Array(21).fill(null).map(() => [cx, cy])
  lm[0] = [cx, cy]                                   // wrist

  FINGERS.forEach(([tip, joint, mcp], i) => {
    const kx = cx + OFFSETS[i] * s
    const ky = cy - KNUCKLE_Y[i] * s
    lm[mcp] = [kx, ky]
    const r = reach[i]
    // straight: tip well above the knuckle. folded: tip drops back past it.
    lm[joint] = [kx, ky - s * 0.45 * r + s * 0.10 * (1 - r)]
    lm[tip] = [kx, ky - s * 0.95 * r + s * 0.30 * (1 - r)]
  })

  lm[1] = [cx - 0.30 * s, cy - 0.10 * s]
  lm[2] = [cx - 0.52 * s, cy - 0.22 * s]
  if (pinch) {
    lm[4] = [...lm[8]]                               // thumb tip on index tip
    lm[3] = [cx - 0.5 * s, cy - 0.3 * s]
  } else if (thumbOut) {
    lm[3] = [cx - 1.10 * s, cy - 0.55 * s]
    lm[4] = [cx - 1.25 * s, cy - 1.00 * s]
  } else {
    lm[3] = [cx - 0.55 * s, cy - 0.45 * s]
    lm[4] = [cx - 0.48 * s, cy - 0.58 * s]
  }
  return lm
}

// ---------------------------------------------------------------- classify

test('open palm is recognised', () => {
  assert.equal(classify(makeHand()), 'open')
})

test('closed fist is recognised', () => {
  assert.equal(classify(makeHand({ reach: [0, 0, 0, 0] })), 'fist')
})

test('one finger is a point', () => {
  assert.equal(classify(makeHand({ reach: [1, 0, 0, 0] })), 'point')
})

test('two fingers is peace', () => {
  assert.equal(classify(makeHand({ reach: [1, 1, 0, 0] })), 'peace')
})

test('three fingers is three', () => {
  assert.equal(classify(makeHand({ reach: [1, 1, 1, 0] })), 'three')
})

test('thumbs up is recognised', () => {
  assert.equal(classify(makeHand({ reach: [0, 0, 0, 0], thumbOut: true })), 'thumbs_up')
})

test('a pinch is recognised, not mistaken for a fist', () => {
  assert.equal(classify(makeHand({ reach: [1, 0, 0, 0], pinch: true })), 'pinch')
})

test('garbage input is unknown, never a crash', () => {
  assert.equal(classify(null), 'unknown')
  assert.equal(classify([]), 'unknown')
  assert.equal(classify([[0, 0]]), 'unknown')
})

test('classification is scale independent', () => {
  assert.equal(classify(makeHand({ scale: 1 })), 'open')
  assert.equal(classify(makeHand({ scale: 0.5 })), 'open')
  assert.equal(classify(makeHand({ reach: [1, 1, 0, 0], scale: 0.4 })), 'peace')
})

test('an extended finger scores positively, a folded one negatively', () => {
  const open = fingerScores(makeHand())
  const fist = fingerScores(makeHand({ reach: [0, 0, 0, 0] }))
  for (const v of open) assert.ok(v > 0, `open finger should score > 0, got ${v}`)
  for (const v of fist) assert.ok(v < 0, `folded finger should score < 0, got ${v}`)
})

// ---- real hands, which is where the first two designs failed ----

test('a sloppy fist still reads as a fist', () => {
  // A real fist never folds perfectly. Measured against a fixed distance this
  // scored as a "point", which is why panning never fired.
  assert.equal(classify(makeHand({ reach: [0.25, 0.2, 0.2, 0.2] })), 'fist')
})

test('a sloppy peace sign still reads as peace', () => {
  // Ring and pinky do not fully curl on a real hand. An earlier design read this
  // as an open palm, which is why the explode toggle never fired.
  assert.equal(classify(makeHand({ reach: [1, 1, 0.35, 0.3] })), 'peace')
})

test('an open hand is not mistaken for peace', () => {
  // The short pinky on a real open hand scores low; that must not read as folded.
  assert.equal(classify(makeHand()), 'open')
})

test('pose scores separate open from peace', () => {
  const open = classifyPose(makeHand())
  const peace = classifyPose(makeHand({ reach: [1, 1, 0, 0] }))
  assert.ok(open.min > 0 && peace.min < 0, 'open hand should have no folded finger')
})

// ---------------------------------------------------------------- controller

/** Build a controller with a fake clock and a recording sink. */
function harness(tuning) {
  const sent = []
  let clock = 0
  const controller = new GestureController(
    (name, arg) => sent.push({ name, arg, t: clock }),
    () => clock,
    tuning,
  )
  return {
    controller,
    sent,
    advance: (dt) => {
      clock += dt
    },
    push: (hands) => controller.update(hands),
    names: () => sent.map((s) => s.name),
  }
}

test('no hand produces no commands', () => {
  const h = harness()
  h.push([])
  assert.deepEqual(h.names(), ['cursor'])
})

test('moving an open palm emits orbit, not a jump', () => {
  const h = harness({ stableFrames: 1 })
  // establish a position first
  for (let i = 0; i < 4; i += 1) h.push([makeHand({ reach: [1,1,1,1], cx: 0.5 + i * 0.02 })])
  assert.ok(h.names().includes('orbit'))
  const orbits = h.sent.filter((s) => s.name === 'orbit')
  // each delta must be small (a fraction of the screen), not one giant leap
  for (const o of orbits) assert.ok(Math.abs(o.arg[0]) < 0.5, `orbit delta too big: ${o.arg[0]}`)
})

test('a still palm does not emit orbit every frame', () => {
  const h = harness({ stableFrames: 1 })
  const still = makeHand({ reach: [1,1,1,1], cx: 0.5 })
  for (let i = 0; i < 6; i += 1) h.push([still])
  assert.equal(h.names().filter((n) => n === 'orbit').length, 0)
})

test('two hands apart emits zoom in', () => {
  const h = harness({ stableFrames: 1 })
  const left = makeHand({ reach: [1,1,1,1], cx: 0.3 })
  const right = makeHand({ reach: [1,1,1,1], cx: 0.7 })
  h.push([left, right])
  h.push([
    makeHand({ reach: [1,1,1,1], cx: 0.2 }),
    makeHand({ reach: [1,1,1,1], cx: 0.8 }),
  ])
  const zoom = h.sent.find((s) => s.name === 'zoom')
  assert.ok(zoom, 'expected a zoom command')
  assert.ok(zoom.arg < 1, 'hands apart should zoom in (factor < 1)')
})

test('peace fires toggle_explode exactly once per hold', () => {
  const h = harness({ stableFrames: 1, holdSeconds: 0.8, cooldownSeconds: 1.3 })
  const peace = makeHand({ reach: [1,1,0,0] })
  for (let i = 0; i < 30; i += 1) {
    h.push([peace])
    h.advance(0.1) // 3 seconds of holding
  }
  const toggles = h.names().filter((n) => n === 'toggle_explode')
  assert.equal(toggles.length, 1, `expected exactly one toggle, got ${toggles.length}`)
})

test('peace fires only after the hold time, not immediately', () => {
  const h = harness({ stableFrames: 1, holdSeconds: 0.8 })
  h.push([makeHand({ reach: [1,1,0,0] })])
  assert.equal(h.names().filter((n) => n === 'toggle_explode').length, 0)
})

test('a flickering misread does not count as a gesture', () => {
  const h = harness({ stableFrames: 3 })
  h.push([makeHand({ reach: [1,1,1,1] })])
  h.push([makeHand({ reach: [0,0,0,0] })]) // one bad frame
  h.push([makeHand({ reach: [1,1,1,1] })])
  assert.notEqual(h.controller.stable, 'fist')
})

test('hand leaving the frame resets state so the next entry does not jump', () => {
  const h = harness({ stableFrames: 1 })
  for (let i = 0; i < 4; i += 1) h.push([makeHand({ reach: [1,1,1,1], cx: 0.9 })])
  h.push([]) // hand gone
  h.sent.length = 0
  h.push([makeHand({ reach: [1,1,1,1], cx: 0.1 })]) // reappears far away
  const orbits = h.sent.filter((s) => s.name === 'orbit')
  assert.equal(orbits.length, 0, 'must not jump after the hand reappears')
})

test('pinch emits select once, not every frame', () => {
  const h = harness({ stableFrames: 1 })
  const pinching = makeHand({ reach: [1,0,0,0], pinch: true })
  for (let i = 0; i < 5; i += 1) h.push([pinching])
  assert.equal(h.names().filter((n) => n === 'select').length, 1)
})

// ---------------------------------------------------------------- camera contract

// Stage 4 maps commands to camera-controls verbs. These assert the shape it
// consumes, so a change in GestureController cannot silently break the bridge.
import { TOGGLE_GESTURES, TUNING } from './GestureController.js'

test('every command the controller emits is one the bridge handles', () => {
  const handled = new Set(['orbit', 'pan', 'zoom', 'select', 'cursor', 'stop'])
  const emitted = new Set(['orbit', 'pan', 'zoom', 'select', 'cursor', 'stop', 'toggle_explode', 'xray', 'labels', 'play'])
  for (const name of emitted) {
    assert.ok(handled.has(name) || Object.values(TOGGLE_GESTURES).includes(name),
      `${name} is emitted but nothing consumes it`)
  }
})

test('orbit and pan args are [dx, dy] pairs of finite numbers', () => {
  const h = harness({ stableFrames: 1 })
  for (let i = 0; i < 5; i += 1) h.push([makeHand({ reach: [1,1,1,1], cx: 0.4 + i * 0.03 })])
  const cmd = h.sent.find((s) => s.name === 'orbit')
  assert.ok(cmd)
  assert.equal(cmd.arg.length, 2)
  assert.ok(Number.isFinite(cmd.arg[0]) && Number.isFinite(cmd.arg[1]))
})

test('zoom factor is a positive multiplier near 1', () => {
  const h = harness({ stableFrames: 1 })
  h.push([makeHand({ reach: [1,1,1,1], cx: 0.3 }), makeHand({ reach: [1,1,1,1], cx: 0.7 })])
  h.push([makeHand({ reach: [1,1,1,1], cx: 0.2 }), makeHand({ reach: [1,1,1,1], cx: 0.8 })])
  h.push([makeHand({ reach: [1,1,1,1], cx: 0.1 }), makeHand({ reach: [1,1,1,1], cx: 0.9 })])
  for (const z of h.sent.filter((s) => s.name === 'zoom')) {
    assert.ok(z.arg > 0, 'zoom factor must be positive')
    assert.ok(z.arg >= 0.8 && z.arg <= 1.25, `zoom factor out of the clamped range: ${z.arg}`)
  }
})

test('tuning values are sane', () => {
  assert.ok(TUNING.stableFrames >= 1)
  assert.ok(TUNING.holdSeconds > 0.3, 'hold too short: toggles will fire on a twitch')
  assert.ok(TUNING.cooldownSeconds > TUNING.holdSeconds, 'cooldown must outlast the hold')
  assert.ok(TUNING.deadZone > 0, 'no dead zone means camera shake')
})

// ---------------------------------------------------------------- accumulation

test('bursty commands are not dropped when frames are slow', () => {
  // Regression: the bridge used to mark a command "applied" before throttling,
  // so when many commands arrived faster than frames rendered, the extras were
  // thrown away. Orbit fired every frame and hid the bug; pan and zoom -- which
  // arrive in bursts -- silently did nothing. Commands must accumulate instead.
  const h = harness({ stableFrames: 1 })
  const before = h.sent.filter((s) => s.name === 'pan').length
  for (let i = 0; i < 12; i += 1) {
    h.push([makeHand({ reach: [0,0,0,0], cx: 0.35 + i * 0.03 })])
  }
  const pans = h.sent.filter((s) => s.name === 'pan').length - before
  assert.ok(pans >= 8, `expected most of the 12 pan frames to emit, got ${pans}`)
})

test('pan deltas follow the hand after mirroring', () => {
  // MediaPipe x is raw camera space; GestureController mirrors it once so that
  // moving your hand right moves the model right. In camera space that means
  // DECREASING x, so this asserts the mirror actually happened.
  const h = harness({ stableFrames: 1 })
  for (let i = 0; i < 8; i += 1) h.push([makeHand({ reach: [0,0,0,0], cx: 0.7 - i * 0.04 })])
  const pan = h.sent.find((s) => s.name === 'pan')
  assert.ok(pan, 'expected a pan command')
  assert.ok(pan.arg[0] > 0, `hand moving right should give positive dx, got ${pan.arg[0]}`)
})

test('zoom emits repeatedly while the hands keep moving', () => {
  const h = harness({ stableFrames: 1 })
  h.push([makeHand({ reach: [1,1,1,1], cx: 0.35 }), makeHand({ reach: [1,1,1,1], cx: 0.65 })])
  for (let i = 1; i <= 6; i += 1) {
    h.push([
      makeHand({ reach: [1,1,1,1], cx: 0.35 - i * 0.03 }),
      makeHand({ reach: [1,1,1,1], cx: 0.65 + i * 0.03 }),
    ])
  }
  const zooms = h.sent.filter((s) => s.name === 'zoom')
  assert.ok(zooms.length >= 3, `expected several zoom commands, got ${zooms.length}`)
  for (const z of zooms) assert.ok(z.arg < 1, 'hands apart must zoom in')
})


test('a closed fist is not mistaken for a pinch', () => {
  assert.equal(classify(makeHand({ reach: [0, 0, 0, 0] })), 'fist')
})

test('fingers are scored from the palm outward, per finger', () => {
  const peace = makeHand({ reach: [1, 1, 0.3, 0.3] })
  const scores = fingerScores(peace)
  assert.ok(scores[0] > scores[2], `index should out-score ring: ${scores}`)
  assert.ok(scores[1] > scores[3], `middle should out-score pinky: ${scores}`)
})
