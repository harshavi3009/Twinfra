// Layout helpers shared by Ground (draws paths) and Trees (avoids them).

export const HUB = { x: 0, z: 15 } // central plaza the paths radiate from

// Axis-aligned path segments: hub -> along x -> along z -> building.
// Each segment is { x1, z1, x2, z2 } (always horizontal or vertical).
export function buildPaths(buildings = []) {
  const segs = []
  for (const b of buildings) {
    const { x, z } = b.position
    if (x !== HUB.x) segs.push({ x1: HUB.x, z1: HUB.z, x2: x, z2: HUB.z })
    if (z !== HUB.z) segs.push({ x1: x, z1: HUB.z, x2: x, z2: z })
  }
  return segs
}

// Grid cells for n rooms on one floor, laid out by order (no coordinates in the data).
// Coordinates are local to the building centre; w/d are the room tile size.
export function roomCells(n, size) {
  if (!n) return []
  const innerW = size.w - 3
  const innerD = size.d - 3
  const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * innerW) / innerD))))
  const rows = Math.ceil(n / cols)
  const cw = innerW / cols
  const cd = innerD / rows
  return Array.from({ length: n }, (_, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    return {
      x: -innerW / 2 + cw * (c + 0.5),
      z: -innerD / 2 + cd * (r + 0.5),
      w: Math.max(1, cw - 0.8),
      d: Math.max(1, cd - 0.8),
    }
  })
}

// Distance from point (px, pz) to an axis-aligned segment.
export function distToSegment(px, pz, s) {
  const minX = Math.min(s.x1, s.x2)
  const maxX = Math.max(s.x1, s.x2)
  const minZ = Math.min(s.z1, s.z2)
  const maxZ = Math.max(s.z1, s.z2)
  const dx = Math.max(minX - px, 0, px - maxX)
  const dz = Math.max(minZ - pz, 0, pz - maxZ)
  return Math.hypot(dx, dz)
}
