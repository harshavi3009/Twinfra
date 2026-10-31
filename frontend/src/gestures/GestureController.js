/**
 * Stage 3 of hand control: a stream of per-frame gestures -> viewer commands.
 *
 * Pure and testable. `send(name, arg)` is the only output, so in a test you pass
 * a fake `send` and a fake clock and assert exactly which commands came out.
 *
 * The hard part of hand control is not recognising a gesture, it is behaviour
 * over time:
 *   - a wobbling hand must not shake the camera  -> smoothing + dead zone
 *   - a momentary misread must not fire an action -> stable-for-N-frames
 *   - holding a toggle must fire once, not 30x   -> hold time + cooldown
 *   - the hand leaving the frame must not cause a jump when it returns -> reset
 */

import {
  classify,
  handSize,
  palmCenter,
  twoHandDistance,
  mirror,
  fingerScores,
} from './classify.js'

// ---- tuning (all in one place so it can be explained and adjusted) ----
export const TUNING = {
  /** Frames a gesture must persist before it counts. At 15 fps, 3 ≈ 200 ms. */
  stableFrames: 2,
  /** Frames of landmarks to average before classifying; damps sensor jitter. */
  smoothFrames: 6,
  /** Seconds a toggle gesture must be held before it fires. */
  holdSeconds: 0.8,
  /** Seconds after a toggle before it can fire again. */
  cooldownSeconds: 1.3,
  /** Palm movement below this (normalised units) counts as "not moving". */
  deadZone: 0.004,
  /** Rotate gain: palm delta -> radians. Deliberately small; jitter is amplified here. */
  orbitGain: 5.0,
  /** Pan gain: palm delta -> world units. */
  panGain: 1.2,
  /** Two-hand zoom: ignore distance changes smaller than this ratio. */
  zoomDeadZone: 0.006,
  /** Exponential smoothing for palm position. 0 = no smoothing, 1 = frozen. */
  smoothing: 0.55,
}

/** Gestures that fire once when held, rather than continuously. */
/**
 * Hold-to-fire gestures. Every value here MUST have a matching branch in
 * GestureCameraBridge — `gestures.test.js` reads the bridge source and fails if
 * one does not. `toggle_explode` was once emitted with no branch at all, which
 * is why the peace gesture appeared to do nothing.
 *
 * thumbs_up/xray and call/labels were removed for the same reason: nothing
 * consumed them, so they were gestures that silently did nothing.
 */
export const TOGGLE_GESTURES = {
  peace: 'toggle_explode',
}

/** Element-wise mean of several hands with the same landmark layout. */
function averageFrames(frames) {
  const n = frames.length
  return frames[0].map((_, k) => [
    frames.reduce((sum, f) => sum + f[k][0], 0) / n,
    frames.reduce((sum, f) => sum + f[k][1], 0) / n,
  ])
}

export class GestureController {
  /**
   * @param {(name: string, arg: any) => void} send  receives viewer commands
   * @param {() => number} now  monotonic clock in seconds (injectable for tests)
   * @param {Partial<typeof TUNING>} tuning
   */
  constructor(send, now = () => performance.now() / 1000, tuning = {}) {
    this.send = send
    /** Last 20 commands emitted, newest first. Read by the debug overlay. */
    this.history = []
    /** Debug only: what the classifier said this frame, and the finger ratios. */
    this.lastRaw = '-'
    this.lastRatios = null
    /** Rolling window of recent landmarks, averaged before classification. */
    this.frameBuf = []
    /** Previous per-finger up/down state, for threshold hysteresis. */
    this.lastUp = null
    this.now = now
    this.tuning = { ...TUNING, ...tuning }

    this.prevPalm = null // last smoothed palm centre (rotate / pan)
    this.prevTwo = null // last two-hand distance (zoom)
    this.prevSize = null // last one-hand size (fist zoom)
    this.smoothPalm = null // exponential moving average

    this.candidate = null // gesture we are waiting to see repeatedly
    this.candidateCount = 0
    this.stable = 'none' // currently accepted gesture

    this.heldSince = 0
    this.lastFire = 0
    this.firedForHold = false
    this.pinching = false
    this.stillSince = null

    this.lastGesture = 'none'
    this.lastGestureAt = 0
  }

  /**
   * Feed one frame.
   * @param {number[][][]} hands array of hands, each 21 × [x, y] in image coords
   * @returns {string} the accepted gesture name, for the HUD
   */
  update(hands) {
    const t = this.now()
    // Mirror once, here: everything below (palm deltas, pinch points) is then in
    // screen space, which is what the camera bridge expects.
    const mirrored = (hands || []).map(mirror)

    if (mirrored.length === 0) {
      this.reset()
      return 'none'
    }

    // ---- two hands: zoom ----
    if (mirrored.length >= 2) {
      const dist = twoHandDistance(mirrored)
      // A tiny distance means one detection is junk; skip rather than emit a
      // wild ratio that yanks the camera.
      if (dist > 0.02) {
        if (this.prevTwo) {
          const ratio = dist / this.prevTwo
          if (Math.abs(ratio - 1) > this.tuning.zoomDeadZone) {
            // hands apart -> ratio > 1 -> zoom IN -> command factor < 1
            const clamped = Math.max(0.8, Math.min(1.25, ratio))
            this.send('zoom', 1 / clamped)
          }
        }
        this.prevTwo = dist
      }
      this.prevPalm = null
      this.smoothPalm = null
      this.lastGesture = 'zoom'
      this.lastGestureAt = t
      this.stable = 'zoom'
      return 'zoom'
    }

    this.prevTwo = null

    // ---- one hand ----
    // Average the last few frames' landmark positions before classifying.
    //
    // MediaPipe jitters a couple of percent frame to frame, which is enough to
    // flip a finger sitting near the extension threshold. Classifying single
    // frames made a held `point` flicker to `fist` every ~6th frame, and because
    // the stabiliser wants consecutive agreement it then never latched at all --
    // so the cursor simply never appeared. Averaging coordinates is cheaper and
    // more faithful than averaging the derived scores, since the geometry stays
    // consistent (a mean of two valid hands is still a valid hand).
    this.frameBuf.push(mirrored[0])
    if (this.frameBuf.length > this.tuning.smoothFrames) this.frameBuf.shift()
    const lm = this.frameBuf.length > 1 ? averageFrames(this.frameBuf) : mirrored[0]

    const raw = classify(lm)
    this.lastRaw = raw
    this.lastRatios = fingerScores(lm)
    // Coming back from two-hand zoom, the last gesture was "zoom"; seed the
    // stabiliser so returning to a fist does not need three more frames.
    if (this.stable === 'zoom') {
      this.stable = raw
      this.candidate = raw
      this.candidateCount = this.tuning.stableFrames
    }
    const gesture = this.stabilise(raw)

    const palm = palmCenter(lm)
    this.smoothPalm = this.smoothPalm
      ? [
          this.smoothPalm[0] + (palm[0] - this.smoothPalm[0]) * (1 - this.tuning.smoothing),
          this.smoothPalm[1] + (palm[1] - this.smoothPalm[1]) * (1 - this.tuning.smoothing),
        ]
      : palm

    if (gesture === 'open') {
      this.emitMotion(t, 'orbit', this.tuning.orbitGain, [
        -this.tuning.orbitGain, // hand right -> theta decreases -> model turns right
        this.tuning.orbitGain,
      ])
      this.send('cursor', null)
    } else if (gesture === 'fist') {
      // `prevPalm` is only kept for open/fist, so it is already null on the
      // frame we switch gestures -- no need to also gate on lastGesture, which
      // cost us the whole first pan frame.
      if (this.prevPalm) {
        this.send('pan', [
          (this.smoothPalm[0] - this.prevPalm[0]) * this.tuning.panGain,
          (this.smoothPalm[1] - this.prevPalm[1]) * this.tuning.panGain,
        ])
      }
      // Zoom shares the fist with pan, but only when the depth change clearly
      // dominates the sideways movement. Firing both at once made pan feel
      // sluggish and zoom feel broken: every small push re-dollied the camera
      // while you were trying to slide the view.
      const size = handSize(lm)
      if (this.prevSize) {
        const ratio = size / this.prevSize
        const lateral = this.prevPalm
          ? Math.abs(this.smoothPalm[0] - this.prevPalm[0]) +
            Math.abs(this.smoothPalm[1] - this.prevPalm[1])
          : 0
        // only zoom when the hand is growing/shrinking more than it is moving
        const depth = Math.abs(ratio - 1)
        // Only zoom when the depth change genuinely dominates sideways motion.
        // 2x, not 'greater than': a fist sliding across the frame also changes
        // its apparent size slightly, and that alone was firing zoom.
        if (depth > this.tuning.zoomDeadZone && depth > lateral * 2) {
          this.send('zoom', 1 / Math.max(0.92, Math.min(1.09, ratio)))
        }
      }
      this.prevSize = size
      this.send('cursor', null)
      } else if (gesture === 'thumbs_up') {
      // Zoom has its OWN gesture. Sharing the fist with pan meant every sideways
      // move also nudged the dolly, which made pan feel slow and zoom feel
      // broken. Thumbs up + hand closer/further = zoom, and nothing else.
      const size = handSize(lm)
      if (this.prevSize) {
        const ratio = size / this.prevSize
        if (Math.abs(ratio - 1) > this.tuning.zoomDeadZone * 3) {
          this.send('zoom', 1 / Math.max(0.9, Math.min(1.12, ratio)))
        }
      }
      this.prevSize = size
      this.send('cursor', null)
    } else if (gesture === 'point' || gesture === 'pinch') {
      const tip = lm[8]
      this.send('cursor', [tip[0], tip[1]])

      if (gesture === 'pinch' && !this.pinching) this.send('select', [tip[0], tip[1]])
      this.pinching = gesture === 'pinch'
    }

    // remember position only for the gestures that use it
    this.prevPalm = gesture === 'open' || gesture === 'fist' ? this.smoothPalm : null
    if (gesture !== 'thumbs_up') this.prevSize = null


    if (gesture !== 'pinch') this.pinching = false

    // ---- hold-to-toggle ----
    const toggle = TOGGLE_GESTURES[gesture]
    if (toggle) {
      if (!this.firedForHold) {
        if (this.heldSince === 0) this.heldSince = t
        if (
          t - this.heldSince >= this.tuning.holdSeconds &&
          t - this.lastFire >= this.tuning.cooldownSeconds
        ) {
          this.send(toggle, null)
          this.lastFire = t
          this.firedForHold = true // do not fire again until the hand changes
        }
      }
    } else {
      this.heldSince = 0
      this.firedForHold = false
    }

    this.lastGesture = gesture
    return gesture
  }

  /** Accept a gesture only after it has appeared `stableFrames` times in a row. */
  stabilise(gesture) {
    if (gesture === this.candidate) {
      this.candidateCount += 1
    } else {
      this.candidate = gesture
      this.candidateCount = 1
    }
    if (this.candidateCount >= this.tuning.stableFrames) this.stable = gesture
    return this.stable
  }

  /** Emit a rotate/pan command if the palm moved beyond the dead zone. */
  emitMotion(t, name, gain, sign) {
    if (!this.prevPalm) return
    const dx = this.smoothPalm[0] - this.prevPalm[0]
    const dy = this.smoothPalm[1] - this.prevPalm[1]

    if (Math.abs(dx) + Math.abs(dy) <= this.tuning.deadZone) {
      // holding still: after a moment, treat that as "stop"
      if (this.stillSince === null) this.stillSince = t
      else if (t - this.stillSince > 1.2 && t - this.lastFire > this.tuning.cooldownSeconds) {
        this.send('stop', null)
        this.lastFire = t
        this.stillSince = null
      }
      return
    }

    this.stillSince = null
    this.send(name, [dx * sign[0], dy * sign[1]])
  }

  reset() {
    this.prevPalm = null
    this.prevTwo = null
    this.smoothPalm = null
    this.candidate = null
    this.candidateCount = 0
    this.stable = 'none'
    this.heldSince = 0
    this.firedForHold = false
    this.pinching = false
    this.stillSince = null
    this.lastGesture = 'none'
    this.send('cursor', null)
  }
}
