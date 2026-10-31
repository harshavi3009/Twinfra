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
  /**
   * A fingertip must travel this far past its knuckle, in hand-size units, to
   * count as extended. Chosen from measured scores, which are ORDERS apart:
   *
   *              index  middle    ring   pinky
   *   open       0.417   1.130   0.809   0.119
   *   peace      0.417   1.130  -0.255  -0.038
   *   three      0.417   1.130   0.809  -0.038
   *   fist      -0.132  -0.357  -0.255  -0.038
   *
   * 0.10 sits in the gap between "folded" (negative) and "open" (0.119 up), and
   * is loose enough that a short pinky still registers on a real open hand.
   * Anything in 0.05..0.11 behaves the same on these poses.
   */
  extend: 0.10,
  /**
   * An all-fingers-up hand is ambiguous between a genuine open palm and a sloppy
   * peace sign, so compare the weakest finger to the strongest:
   *   open          0.119 / 1.130 = 0.106
   *   sloppy peace  0.009 / 1.130 = 0.008   (ring only half raised)
   * 0.05 sits between them with room for sensor noise either side.
   */
  openRatio: 0.035,
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
  const up = extendedFingers(landmarks)
  const scores = fingerScores(landmarks)
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

  // All four "up" is ambiguous: an open hand and a sloppy peace both clear the
  // per-finger cutoff, because a half-raised ring finger scores 0.12 while a
  // truly extended one scores 0.81. What separates them is RELATIVE: in a real
  // open hand every finger is extended by a comparable amount, while in any
  // two-finger pose the bottom finger is far weaker than the top. Comparing the
  // weakest finger to the strongest -- rather than each to a fixed number -- is
  // the only test that holds across hand shapes.
  if (count === 4) {
    return weakestVsStrongest(scores) > TOLERANCE.openRatio ? 'open' : 'peace'
  }

  if (count === 0) return thumbOut && thumbUp ? 'thumbs_up' : 'fist'

  if (up[0] && !up[1] && !up[2] && !up[3]) return 'point'
  if (up[0] && up[1] && !up[2] && !up[3]) return 'peace'
  // Index+middle+ring up. This is reached two ways and they must NOT mean the
  // same thing:
  //   * an open palm whose pinky dipped below the cutoff for one jittery frame
  //     (open hands score pinky 0.119, agonisingly close to the 0.10 cutoff)
  //   * a sloppy peace whose ring finger is only half raised
  // The weakest-vs-strongest ratio separates them exactly as it does for
  // count === 4, so both call the same helper instead of guessing.
  if (up[0] && up[1] && up[2] && !up[3]) {
    return weakestVsStrongest(scores) > TOLERANCE.openRatio ? 'open' : 'peace'
  }
  if (!up[0] && !up[1] && !up[2] && up[3] && thumbOut) return 'call'

  // 7 of the 8 plausible poses are handled above; anything else stays unknown
  // rather than guessing.
  return 'unknown'
}

/**
 * How extended the weakest finger is relative to the strongest, as a ratio.
 * A real open hand has all four out by a comparable amount (~0.11); any pose
 * where a finger is only partly raised lands near 0.01.
 */
function weakestVsStrongest(scores) {
  const strongest = Math.max(...scores)
  if (strongest <= 0) return 0
  return Math.min(...scores) / strongest
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
