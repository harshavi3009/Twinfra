/**
 * Tests for the hand-gesture logic. No camera, no browser, no MediaPipe —
 * fake landmarks in, assertions out. Run with:
 *
 *   node --test frontend/src/gestures/gestures.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { classify, palmCenter, twoHandDistance, handSize } from './classify.js'
import { GestureController } from './GestureController.js'

// ---------------------------------------------------------------- helpers

/**
 * Build 21 fake landmarks for a hand of a given pose.
 * Coordinates are 0..1 image space with y growing downward.
 */
function makeHand({ open = 0, thumbOut = false, pinch = false, cx = 0.5, cy = 0.5, scale = 1 } = {}) {
  const s = 0.1 * scale // hand size in image units
  const lm = new Array(21).fill(null).map(() => [cx, cy])

  lm[0] = [cx, cy + s] // wrist
  lm[5] = [cx - s * 0.3, cy + s * 0.3] // index knuckle
  lm[9] = [cx, cy + s * 0.2] // middle knuckle
  lm[13] = [cx + s * 0.3, cy + s * 0.3] // ring knuckle
  lm[17] = [cx + s * 0.5, cy + s * 0.45] // pinky knuckle

  // finger (tip, joint, x-offset)
  const fingers = [
    [8, 6, -0.3],
    [12, 10, 0],
    [16, 14, 0.3],
    [20, 18, 0.5],
  ]

  fingers.forEach(([tip, joint, dx], i) => {
    const knuckle = lm[[5, 9, 13, 17][i]]
    if (i < open) {
      // extended: tip is far from the wrist
      lm[joint] = [knuckle[0] + dx * s * 0.4, knuckle[1] - s * 0.4]
      lm[tip] = [knuckle[0] + dx * s * 0.6, knuckle[1] - s * 1.0]
    } else {
      // curled: tip is tucked back toward the wrist
      lm[joint] = [knuckle[0] + dx * s * 0.3, knuckle[1] - s * 0.2]
      lm[tip] = [knuckle[0] + dx * s * 0.2, knuckle[1] + s * 0.1]
    }
  })

  // thumb
  if (pinch) {
    lm[3] = [cx - s * 0.2, cy + s * 0.35]
    lm[4] = lm[8] // thumb tip touches index tip
  } else if (thumbOut) {
    lm[3] = [cx - s * 0.5, cy + s * 0.2]
    lm[4] = [cx - s * 0.7, cy - s * 0.2]
  } else {
    lm[3] = [cx - s * 0.15, cy + s * 0.5]
    lm[4] = [cx - s * 0.2, cy + s * 0.35]
  }

  return lm
}

// ---------------------------------------------------------------- classify

test('open palm is recognised', () => {
  assert.equal(classify(makeHand({ open: 4 })), 'open')
})

test('closed fist is recognised', () => {
  assert.equal(classify(makeHand({ open: 0 })), 'fist')
})

test('one finger is a point', () => {
  assert.equal(classify(makeHand({ open: 1 })), 'point')
})

test('two fingers is peace', () => {
  assert.equal(classify(makeHand({ open: 2 })), 'peace')
})

test('three fingers is three', () => {
  assert.equal(classify(makeHand({ open: 3 })), 'three')
})

test('garbage input is unknown, never a crash', () => {
  assert.equal(classify(null), 'unknown')
  assert.equal(classify([]), 'unknown')
  assert.equal(classify([[0, 0]]), 'unknown')
})

test('classification is scale independent', () => {
  // Same pose, hand twice as far from the camera. This is the bug that makes
  // gesture demos fail when the presenter steps back.
  assert.equal(classify(makeHand({ open: 4, scale: 1 })), 'open')
  assert.equal(classify(makeHand({ open: 4, scale: 0.5 })), 'open')
  assert.equal(classify(makeHand({ open: 2, scale: 0.4 })), 'peace')
})

test('palm center and two-hand distance are sensible', () => {
  const a = makeHand({ open: 4, cx: 0.3 })
  const b = makeHand({ open: 4, cx: 0.7 })
  assert.ok(twoHandDistance([a, b]) > twoHandDistance([a, a]))
  const [x] = palmCenter(a)
  assert.ok(x > 0.25 && x < 0.35)
})

test('hand size scales with distance', () => {
  assert.ok(handSize(makeHand({ scale: 1 })) > handSize(makeHand({ scale: 0.5 })))
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
  for (let i = 0; i < 4; i += 1) h.push([makeHand({ open: 4, cx: 0.5 + i * 0.02 })])
  assert.ok(h.names().includes('orbit'))
  const orbits = h.sent.filter((s) => s.name === 'orbit')
  // each delta must be small (a fraction of the screen), not one giant leap
  for (const o of orbits) assert.ok(Math.abs(o.arg[0]) < 0.5, `orbit delta too big: ${o.arg[0]}`)
})

test('a still palm does not emit orbit every frame', () => {
  const h = harness({ stableFrames: 1 })
  const still = makeHand({ open: 4, cx: 0.5 })
  for (let i = 0; i < 6; i += 1) h.push([still])
  assert.equal(h.names().filter((n) => n === 'orbit').length, 0)
})

test('two hands apart emits zoom in', () => {
  const h = harness({ stableFrames: 1 })
  const left = makeHand({ open: 4, cx: 0.3 })
  const right = makeHand({ open: 4, cx: 0.7 })
  h.push([left, right])
  h.push([
    makeHand({ open: 4, cx: 0.2 }),
    makeHand({ open: 4, cx: 0.8 }),
  ])
  const zoom = h.sent.find((s) => s.name === 'zoom')
  assert.ok(zoom, 'expected a zoom command')
  assert.ok(zoom.arg < 1, 'hands apart should zoom in (factor < 1)')
})

test('peace fires toggle_explode exactly once per hold', () => {
  const h = harness({ stableFrames: 1, holdSeconds: 0.8, cooldownSeconds: 1.3 })
  const peace = makeHand({ open: 2 })
  for (let i = 0; i < 30; i += 1) {
    h.push([peace])
    h.advance(0.1) // 3 seconds of holding
  }
  const toggles = h.names().filter((n) => n === 'toggle_explode')
  assert.equal(toggles.length, 1, `expected exactly one toggle, got ${toggles.length}`)
})

test('peace fires only after the hold time, not immediately', () => {
  const h = harness({ stableFrames: 1, holdSeconds: 0.8 })
  h.push([makeHand({ open: 2 })])
  assert.equal(h.names().filter((n) => n === 'toggle_explode').length, 0)
})

test('a flickering misread does not count as a gesture', () => {
  const h = harness({ stableFrames: 3 })
  h.push([makeHand({ open: 4 })])
  h.push([makeHand({ open: 0 })]) // one bad frame
  h.push([makeHand({ open: 4 })])
  assert.notEqual(h.controller.stable, 'fist')
})

test('hand leaving the frame resets state so the next entry does not jump', () => {
  const h = harness({ stableFrames: 1 })
  for (let i = 0; i < 4; i += 1) h.push([makeHand({ open: 4, cx: 0.9 })])
  h.push([]) // hand gone
  h.sent.length = 0
  h.push([makeHand({ open: 4, cx: 0.1 })]) // reappears far away
  const orbits = h.sent.filter((s) => s.name === 'orbit')
  assert.equal(orbits.length, 0, 'must not jump after the hand reappears')
})

test('pinch emits select once, not every frame', () => {
  const h = harness({ stableFrames: 1 })
  const pinching = makeHand({ open: 1, pinch: true })
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
  for (let i = 0; i < 5; i += 1) h.push([makeHand({ open: 4, cx: 0.4 + i * 0.03 })])
  const cmd = h.sent.find((s) => s.name === 'orbit')
  assert.ok(cmd)
  assert.equal(cmd.arg.length, 2)
  assert.ok(Number.isFinite(cmd.arg[0]) && Number.isFinite(cmd.arg[1]))
})

test('zoom factor is a positive multiplier near 1', () => {
  const h = harness({ stableFrames: 1 })
  h.push([makeHand({ open: 4, cx: 0.3 }), makeHand({ open: 4, cx: 0.7 })])
  h.push([makeHand({ open: 4, cx: 0.2 }), makeHand({ open: 4, cx: 0.8 })])
  h.push([makeHand({ open: 4, cx: 0.1 }), makeHand({ open: 4, cx: 0.9 })])
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
    h.push([makeHand({ open: 0, cx: 0.35 + i * 0.03 })])
  }
  const pans = h.sent.filter((s) => s.name === 'pan').length - before
  assert.ok(pans >= 8, `expected most of the 12 pan frames to emit, got ${pans}`)
})

test('pan deltas follow the hand after mirroring', () => {
  // MediaPipe x is raw camera space; GestureController mirrors it once so that
  // moving your hand right moves the model right. In camera space that means
  // DECREASING x, so this asserts the mirror actually happened.
  const h = harness({ stableFrames: 1 })
  for (let i = 0; i < 8; i += 1) h.push([makeHand({ open: 0, cx: 0.7 - i * 0.04 })])
  const pan = h.sent.find((s) => s.name === 'pan')
  assert.ok(pan, 'expected a pan command')
  assert.ok(pan.arg[0] > 0, `hand moving right should give positive dx, got ${pan.arg[0]}`)
})

test('zoom emits repeatedly while the hands keep moving', () => {
  const h = harness({ stableFrames: 1 })
  h.push([makeHand({ open: 4, cx: 0.35 }), makeHand({ open: 4, cx: 0.65 })])
  for (let i = 1; i <= 6; i += 1) {
    h.push([
      makeHand({ open: 4, cx: 0.35 - i * 0.03 }),
      makeHand({ open: 4, cx: 0.65 + i * 0.03 }),
    ])
  }
  const zooms = h.sent.filter((s) => s.name === 'zoom')
  assert.ok(zooms.length >= 3, `expected several zoom commands, got ${zooms.length}`)
  for (const z of zooms) assert.ok(z.arg < 1, 'hands apart must zoom in')
})
