/**
 * Stage 2 of hand control: 21 MediaPipe landmarks -> one gesture name.
 *
 * Pure functions only. No camera, no DOM, no async — easy to test, easy to read.
 *
 * ## Landmark indices (fixed for every hand)
 *
 *          8   12  16  20      tips:      index, middle, ring, pinky
 *          |   |   |   |
 *          7   11  15  19      PIP joints
 *          6   10  14  18      MCP joints
 *    4     |   |   |   |
 *    |     5   9  13  17      knuckles
 *    3
 *    |     0 = wrist
 *    2
 *
 * ## How a finger is judged, and why it went through three rewrites
 *
 * Attempt 1: "tip is further from the wrist than the middle joint is, times
 * 1.08". Failed because real fists still score 1.10, so a fist read as a point.
 *
 * Attempt 2: compare the four fingers to each other. Failed because the raw
 * ratios are wildly uneven (a straight middle finger can read 14 while a curled
 * pinky reads 1.0), so "are they all similar" never separated the poses.
 *
 * Attempt 3, current: use the actual geometry of a finger. Perpendicular
 * distance to the wrist is meaningless; what matters is whether the fingertip
 * has moved OUT past the knuckle, away from the palm. So each finger is scored
 * by projecting (tip - knuckle) onto the knuckle's own outward direction from
 * the palm. That is a signed length in hand-scaled units — positive when the
 * finger is pointing out, negative when it is folded back into the palm.
 *
 * That score is stable, symmetric, and does not care how long the finger is.
 */

export const WRIST = 0
export const THUMB_TIP = 4
export const THUMB_IP = 3
export const INDEX_MCP = 5
export const INDEX_TIP = 8
export const MIDDLE_MCP = 9
export const PINKY_MCP = 17
export const PINKY_TIP = 20

/** (tip, pip, mcp) for index, middle, ring, pinky. */
export const FINGERS = [
  [8, 6, 5],
  [12, 10, 9],
  [16, 14, 13],
  [20, 18, 17],
]

/**
 * Tuning. The only numbers to touch if a gesture feels unreliable.
 *
 * `extend`  — how far past its knuckle, in hand-size units, a fingertip must
 *             travel before the finger counts as up. 0 means level with the
 *             knuckle; a straight finger scores about 0.8, a fist about -0.3.
 * `pinch`   — thumb tip to index tip closer than this (× hand size).
 * `thumbOut`— thumb tip further than this from the index knuckle (× hand size).
 */
export const TOLERANCE = {
  extend: 0.30,
  /** An open hand's fingers are all extended by a similar amount. */
  flat: 1.1,
  pinch: 0.42,
  thumbOut: 0.85,
}

export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1]
const norm = (a) => {
  const m = Math.hypot(a[0], a[1]) || 1e-6
  return [a[0] / m, a[1] / m]
}

/**
 * MediaPipe reports x in raw camera space, which is mirrored relative to the
 * person looking at it. Flipping x makes "move hand right" mean "move model
 * right". Applied ONCE, at the top of GestureController.
 */
export function mirror(landmarks) {
  return landmarks.map(([x, y]) => [1 - x, y])
}

/** Hand scale = wrist to middle knuckle. Every threshold is a multiple of this. */
export function handSize(lm) {
  return distance(lm[WRIST], lm[MIDDLE_MCP]) || 1e-6
}

/** Rough palm centre: average of the wrist and the four knuckles. */
export function palmCenter(lm) {
  const pts = [lm[WRIST], lm[5], lm[9], lm[13], lm[17]]
  return [pts.reduce((s, p) => s + p[0], 0) / 5, pts.reduce((s, p) => s + p[1], 0) / 5]
}

/**
 * Per-finger extension score, in hand-size units.
 * Positive = pointing away from the palm (extended), negative = folded back.
 */
export function fingerScores(lm) {
  const size = handSize(lm)
  const palm = palmCenter(lm)
  return FINGERS.map(([tip, , mcp]) => {
    const outward = norm(sub(lm[mcp], palm))
    return dot(sub(lm[tip], lm[mcp]), outward) / size
  })
}

/**
 * Which fingers are extended, index..pinky.
 *
 * A single absolute cutoff is not enough on its own: in a genuinely open hand
 * the pinky's knuckle sits closest to the palm centre, so its score can land
 * lower than a clearly-extended finger on a shorter hand. So a finger counts as
 * up when it clears the cutoff, OR when the whole hand is clearly open and this
 * finger is not folded back. Folded fingers score negative; open ones positive.
 */
export function extendedFingers(lm) {
  const scores = fingerScores(lm)
  return scores.map((s) => s > TOLERANCE.extend)
}

/**
 * Decides the pose, not just per-finger flags.
 *
 * An open palm is called from the shape as a whole: every finger positive AND
 * all roughly equally extended. That second condition is what separates a real
 * open hand (pinky 0.12, middle 1.13 — the pinky is short, not folded) from a
 * peace sign (ring 0.12 while pinky is 0.01 and truly folded back).
 */
export function classifyPose(lm) {
  const scores = fingerScores(lm)
  const up = scores.map((s) => s > TOLERANCE.extend)
  const max = Math.max(...scores)
  const min = Math.min(...scores)
  return { scores, up, max, min, allPositive: min > 0, spread: max - min }
}

/**
 * @param {number[][]} landmarks 21 × [x, y] in 0..1 image coordinates
 * @returns {'open'|'fist'|'pinch'|'point'|'peace'|'three'|'thumbs_up'|'call'|'unknown'}
 */
export function classify(landmarks) {
  if (!landmarks || landmarks.length < 21) return 'unknown'

  const size = handSize(landmarks)
  const { scores, up } = classifyPose(landmarks)
  const count = up.filter(Boolean).length

  // Thumb: out when its tip is far from the index knuckle relative to hand size.
  const thumbOut =
    distance(landmarks[THUMB_TIP], landmarks[INDEX_MCP]) > size * TOLERANCE.thumbOut

  const thumbUp =
    landmarks[THUMB_TIP][1] <
    Math.min(landmarks[INDEX_MCP][1], landmarks[MIDDLE_MCP][1]) - size * 0.2

  const pinching =
    distance(landmarks[THUMB_TIP], landmarks[INDEX_TIP]) < size * TOLERANCE.pinch

  // Pinch needs a straight index; in a fist the folded index tip sits next to
  // the folded thumb tip, so distance alone would call every fist a pinch.
  if (pinching && up[0]) return 'pinch'

  // Open palm: every finger out past the cutoff, or the whole hand uniformly
  // positive (a short pinky on a real open hand scores low but still positive,
  // while a folded one goes negative).
  const openEq = Math.max(...scores) - Math.min(...scores)
  if (count === 4 || (scores.every((s) => s > 0) && openEq < TOLERANCE.flat)) return 'open'

  if (count === 0) return thumbOut && thumbUp ? 'thumbs_up' : 'fist'

  if (up[0] && !up[1] && !up[2] && !up[3]) return 'point'
  if (up[0] && up[1] && !up[2] && !up[3]) return 'peace'
  if (up[0] && up[1] && up[2] && !up[3]) return 'three'
  if (!up[0] && !up[1] && !up[2] && up[3] && thumbOut) return 'call'

  // 7 of the 8 plausible poses are handled above; anything else stays unknown
  // rather than guessing.
  return 'unknown'
}

/** Distance between two palms, used for two-handed zoom. */
export function twoHandDistance(hands) {
  if (!hands || hands.length < 2) return 0
  return distance(palmCenter(hands[0]), palmCenter(hands[1]))
}

/** Human-readable label for the on-screen indicator. */
export const GESTURE_LABEL = {
  open: 'Rotate',
  fist: 'Pan',
  pinch: 'Select',
  point: 'Point',
  peace: 'Explode floors',
  three: 'Walkthrough',
  thumbs_up: 'X-ray',
  call: 'Labels',
  zoom: 'Zoom',
  none: 'Show your hand',
  unknown: 'Show your hand',
}
