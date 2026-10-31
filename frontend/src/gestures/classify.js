/**
 * Stage 2 of hand control: 21 MediaPipe landmarks -> one gesture name.
 *
 * Pure functions only. No camera, no DOM, no async — so this is easy to test
 * and easy to reason about.
 *
 * MediaPipe hand landmark indices (fixed, same for every hand):
 *
 *          8   12  16  20      index / middle / ring / pinky TIP
 *          |   |   |   |
 *          7   11  15  19      middle joint
 *          6   10  14  18      upper joint
 *    4     |   |   |   |
 *    |     5   9  13  17      knuckle (MCP)
 *    3
 *    |     0 = wrist
 *    2
 *
 * The whole classifier rests on one idea: a finger is extended when its tip is
 * further from the wrist than its middle joint is. Everything is measured
 * relative to hand size, never in raw pixels, so it works whether your hand is
 * near or far from the camera.
 */

export const WRIST = 0
export const THUMB_TIP = 4
export const THUMB_IP = 3
export const INDEX_MCP = 5
export const INDEX_TIP = 8
export const MIDDLE_MCP = 9
export const RING_MCP = 13
export const PINKY_MCP = 17
export const PINKY_TIP = 20

// (tip, middle joint) for index, middle, ring, pinky
export const FINGERS = [
  [8, 6],
  [12, 10],
  [16, 14],
  [20, 18],
]

/**
 * Tolerances. These are the only numbers that need adjusting if a gesture feels
 * unreliable, so they are exported and documented rather than buried inline.
 *
 * EXTEND_FACTOR: how much further than its middle joint a fingertip must be to
 *   count as extended. Lower = easier to trigger (but a slightly bent finger
 *   reads as open); higher = stricter. 1.08 is a good middle ground.
 * PINCH_FACTOR: thumb tip and index tip closer than this (× hand size) is a pinch.
 */
export const TOLERANCE = {
  extend: 1.08,
  pinch: 0.38,
}

export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

/**
 * MediaPipe reports x in raw camera space, so the image is mirrored relative to
 * the person looking at it. Flipping x here makes "move hand right" mean "move
 * model right" instead of left. Applied ONCE, at the top of GestureController,
 * so every downstream delta is already in screen space.
 */
export function mirror(landmarks) {
  return landmarks.map(([x, y]) => [1 - x, y])
}

/** Hand scale = wrist to middle knuckle. Every threshold is a multiple of this. */
export function handSize(lm) {
  return distance(lm[WRIST], lm[MIDDLE_MCP]) || 1e-6
}

/** Which of the four fingers are extended, in order index..pinky. */
export function extendedFingers(lm) {
  return FINGERS.map(
    ([tip, joint]) =>
      distance(lm[WRIST], lm[tip]) > distance(lm[WRIST], lm[joint]) * TOLERANCE.extend,
  )
}

/**
 * @param {number[][]} landmarks 21 × [x, y] in 0..1 image coordinates
 * @returns {'open'|'fist'|'pinch'|'point'|'peace'|'three'|'thumbs_up'|'call'|'unknown'}
 */
export function classify(landmarks) {
  if (!landmarks || landmarks.length < 21) return 'unknown'

  const size = handSize(landmarks)
  const ext = extendedFingers(landmarks)
  const count = ext.filter(Boolean).length

  // The thumb is "out" when its tip is away from both the pinky and index knuckles.
  const thumbOut =
    distance(landmarks[THUMB_TIP], landmarks[PINKY_MCP]) >
      distance(landmarks[THUMB_IP], landmarks[PINKY_MCP]) * 1.15 &&
    distance(landmarks[THUMB_TIP], landmarks[INDEX_MCP]) > size * 0.55

  const pinching = distance(landmarks[THUMB_TIP], landmarks[INDEX_TIP]) < size * TOLERANCE.pinch

  // Pinch is checked first: thumb and index touching reads as "0 or 1 fingers"
  // by the extension test, so it would otherwise be mistaken for a fist.
  if (pinching && (count >= 1 || ext[1] || ext[2] || ext[3])) return 'pinch'

  if (count === 4) return 'open'

  if (count === 0) {
    // A fist with the thumb stretched upward is a thumbs-up.
    const thumbUp =
      landmarks[THUMB_TIP][1] <
      Math.min(landmarks[INDEX_MCP][1], landmarks[MIDDLE_MCP][1]) - size * 0.3
    return thumbOut && thumbUp ? 'thumbs_up' : 'fist'
  }

  if (ext[0] && !ext[1] && !ext[2] && !ext[3]) return 'point'
  if (ext[0] && ext[1] && !ext[2] && !ext[3]) return 'peace'
  if (ext[0] && ext[1] && ext[2] && !ext[3]) return 'three'
  if (!ext[0] && !ext[1] && !ext[2] && ext[3] && thumbOut) return 'call'

  return 'unknown'
}

/** Centre of the palm, used for rotate and pan deltas. */
export function palmCenter(r) {
  return [(r[WRIST][0] + r[MIDDLE_MCP][0]) / 2, (r[WRIST][1] + r[MIDDLE_MCP][1]) / 2]
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
