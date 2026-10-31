import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { FLOOR_HEIGHT, PALETTE, SLAB_THICKNESS, hash01 } from './constants'

const WINDOW_W = 1.4
const WINDOW_H = 1.8
const WALL_INSET = 0.2 // body is this much smaller than the slab on each side

const windowGeo = new THREE.PlaneGeometry(WINDOW_W, WINDOW_H)
const windowMat = new THREE.MeshBasicMaterial({ toneMapped: false })
const LIT = new THREE.Color(PALETTE.windowLit).multiplyScalar(1.7) // >1 so bloom picks it up
const OFF = new THREE.Color(PALETTE.windowOff)

// Window transforms for one floor: a row along each of the four facades.
function buildWindows(buildingId, level, w, d) {
  const out = []
  const y = SLAB_THICKNESS + (FLOOR_HEIGHT - SLAB_THICKNESS) / 2
  const facade = (length, place) => {
    const n = Math.max(2, Math.floor((length - 2) / 3))
    const spacing = (length - 2) / n
    for (let i = 0; i < n; i++) place((i + 0.5) * spacing - (length - 2) / 2)
  }
  const zWall = d / 2 - WALL_INSET + 0.03
  const xWall = w / 2 - WALL_INSET + 0.03

  facade(w, (x) => {
    out.push({ pos: [x, y, zWall], rotY: 0 })
    out.push({ pos: [x, y, -zWall], rotY: Math.PI })
  })
  facade(d, (z) => {
    out.push({ pos: [xWall, y, z], rotY: Math.PI / 2 })
    out.push({ pos: [-xWall, y, z], rotY: -Math.PI / 2 })
  })
  return out.map((win, i) => ({ ...win, lit: hash01(`${buildingId}:${level}:${i}`) > 0.28 }))
}

// One floor = slab + glass body + edge outline + windows (+ roof slab on the top floor).
// Each floor is its own group at its own height so R2 can explode them apart.
export default function Floor({ buildingId, level, size, isTop, geos, mats }) {
  const { w, d } = size
  const windowsRef = useRef()
  const wins = useMemo(() => buildWindows(buildingId, level, w, d), [buildingId, level, w, d])
  const bodyH = FLOOR_HEIGHT - SLAB_THICKNESS

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D()
    wins.forEach((win, i) => {
      dummy.position.set(...win.pos)
      dummy.rotation.set(0, win.rotY, 0)
      dummy.updateMatrix()
      windowsRef.current.setMatrixAt(i, dummy.matrix)
      windowsRef.current.setColorAt(i, win.lit ? LIT : OFF)
    })
    windowsRef.current.instanceMatrix.needsUpdate = true
    windowsRef.current.instanceColor.needsUpdate = true
  }, [wins])

  return (
    <group position-y={(level - 1) * FLOOR_HEIGHT}>
      <mesh geometry={geos.slab} material={mats.slab} position-y={SLAB_THICKNESS / 2} />
      <mesh geometry={geos.body} material={mats.body} position-y={SLAB_THICKNESS + bodyH / 2} />
      <lineSegments
        geometry={geos.edges}
        material={mats.edge}
        position-y={SLAB_THICKNESS + bodyH / 2}
      />
      <instancedMesh ref={windowsRef} args={[windowGeo, windowMat, wins.length]} />
      {isTop && (
        <mesh geometry={geos.slab} material={mats.slab} position-y={FLOOR_HEIGHT + SLAB_THICKNESS / 2} />
      )}
    </group>
  )
}
