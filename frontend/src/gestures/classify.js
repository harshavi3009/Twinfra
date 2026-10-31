/**
 * Stage 2 of hand control: 21 MediaPipe landmarks -> one gesture name.
 *
 * Pure functions only. No camera, no DOM, no async — easy to test, easy to read.
 *
 * MediaPipe hand landmark indices (fixed, identical for every hand):
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
 * ## Why this is RELATIVE, not absolute
 *
 * The obvious rule is "a finger is extended when its tip is further from the
 * wrist than its middle joint". That works for a pose held rigidly, but real
 * hands never fold perfectly: a genuine fist still has fingertips a little past
 * the middle joint. Measured against a fixed cutoff, a real fist scores 1.10 and
 * a real peace sign scores 1.14 — both above any threshold that still lets a
 * fully open hand score 1.62.
 *
 * So we compare fingers to EACH OTHER. Fist, point and peace are all about one
 * finger being clearly straighter than its neighbours, and that difference is
 * large and reliable (1.6 vs 1.05) even on a sloppy hand.
 */

export const WRIST = 0
export const THUMB_TIP = 4
export const THUMB_IP = 3
export const INDEX_MCP = 5
export const INDEX_TIP = 8
export const MIDDLE_MCP = 9
export const THUMB_JOINT = 2

// (tip, middle joint) for index, middle, ring, pinky
export const FINGERS = [
  [8, 6],
  [12, 10],
  [16, 14],
  [20, 18],
]

/**
 * Tuning. The only numbers that matter if a gesture feels unreliable.
 *
 * `spread`  — how far apart the *straightest* and *most-curled* finger must be
 *             for a pose to count as "some fingers up, some down". Below this the
 *             hand is treated as all-open or all-closed.
 * `openAll` — every finger's ratio above this means a flat open palm.
 * `closedAll` — every finger's ratio below this means a fist.
 */
export const TOLERANCE = {
  spread: 0.22,
  openAll: 1.22,
  closedAll: 1.18,
  pinch: 0.42,
}

export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

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

/**
 * How "extended" each finger is, as a ratio: 1.0 means the tip is level with the
 * middle joint, ~1.6 means fully straight. One number per finger, index..pinky.
 */
export function fingerRatios(lm) {
  const wrist = lm[WRIST]
  return FINGERS.map(([tip, joint]) => {
    const j = distance(wrist, lm[joint])
    return j > 1e-6 ? distance(wrist, lm[tip]) / j : 0
  })
}

/** Which fingers are extended, decided by comparing each to the others. */
export function extendedFingers(lm) {
  const r = fingerRatios(lm)
  const max = Math.max(...r)
  const min = Math.min(...r)
  const t = TOLERANCE

  // one flat pose: all up or all down
  if (min > t.closedAll && max - min < t.spread) {
    return r.map((v) => v > t.openAll || (max - min < t.spread && v > (max + min) / 2))
  }
  if (max < t.openAll && max - min < t.spread) {
    return [false, false, false, false]
  }

  // mixed pose: a finger counts as up when it is clearly straighter than average
  const mid = (max + min) / 2
  return r.map((v) => v > mid)
}

/**
 * @param {number[][]} landmarks 21 × [x, y] in 0..1 image coordinates
 * @returns {'open'|'fist'|'pinch'|'point'|'peace'|'three'|'thumbs_up'|'call'|'unknown'}
 */
export function classify(landmarks) {
  if (!landmarks || landmarks.length < 21) return 'unknown'

  const size = handSize(landmarks)
  const ratios = fingerRatios(landmarks)
  const max = Math.max(...ratios)
  const min = Math.min(...ratios)
  const flat = max - min < TOLERANCE.spread

  // The thumb is "out" when its tip is away from both the pinky and index knuckles.
  const thumbOut =
    distance(landmarks[THUMB_TIP], landmarks[17]) >
      distance(landmarks[THUMB_IP], landmarks[17]) * 1.15 &&
    distance(landmarks[THUMB_TIP], landmarks[INDEX_MCP]) > size * 0.55

  const pinching = distance(landmarks[THUMB_TIP], landmarks[INDEX_TIP]) < size * TOLERANCE.pinch

  // Pinch first: thumb and index touching reads as "no fingers up" by the
  // extension test, so it would otherwise be mistaken for a fist.
  if (pinching) return 'pinch'

  // Everything up -> open palm. Checked on the absolute ratio as well, so a
  // genuinely straight hand always wins even if the fingers differ slightly.
  if (min > TOLERANCE.closedAll && (flat || min > TOLERANCE.openAll)) return 'open'

  // Everything down -> fist (or thumbs up if the thumb is up and out).
  if (max < TOLERANCE.closedAll && flat) {
    const thumbUp =
      landmarks[THUMB_TIP][1] <
      Math.min(landmarks[INDEX_MCP][1], landmarks[MIDDLE_MCP][1]) - size * 0.3
    return thumbOut && thumbUp ? 'thumbs_up' : 'fist'
  }

  // Mixed: rank the four fingers against each other.
  const mid = (max + min) / 2
  const up = ratios.map((v) => v > mid)

  if (up[0] && !up[1] && !up[2] && !up[3]) return 'point'
  if (up[0] && up[1] && !up[2] && !up[3]) return 'peace'
  if (up[0] && up[1] && up[2] && !up[3]) return 'three'
  if (!up[0] && !up[1] && !up[2] && up[3] && thumbOut) return 'call'

  // Fall back on the count when the ranking is ambiguous.
  const count = up.filter(Boolean).length
  if (count === 4) return 'open'
  if (count === 0) return 'fist'
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
