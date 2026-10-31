// Shared constants + tiny helpers for the 3D campus.

export const STATUS_COLORS = {
  ok: '#22c55e',
  warning: '#f59e0b',
  critical: '#ef4444',
  offline: '#64748b',
}

export const statusColor = (status) => STATUS_COLORS[status] ?? STATUS_COLORS.offline

export const FLOOR_HEIGHT = 4 // metres per floor
export const SLAB_THICKNESS = 0.35
export const EXPLODE_GAP = 7 // extra metres between floors when a building is selected

// Base height of a floor group; explode is 0 (stacked) .. 1 (fully exploded).
export const floorY = (level, explode = 1) => (level - 1) * (FLOOR_HEIGHT + EXPLODE_GAP * explode)

export const PALETTE = {
  bg: '#050810',
  ground: '#070b14',
  body: '#0b1424',
  slab: '#101b30',
  windowLit: '#9fe8ff',
  windowOff: '#0d192b',
  path: '#16415f',
  grid: '#12233a',
  gridSection: '#1d3b60',
  electric: '#facc15',
  water: '#38bdf8',
}

// Deterministic 0..1 hash of a string (stable window lighting, tree layout).
export function hash01(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

// Small seeded PRNG so the trees are the same on every render.
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
