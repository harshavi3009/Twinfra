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
