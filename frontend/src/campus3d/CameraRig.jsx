import { useEffect, useRef } from 'react'
import { CameraControls } from '@react-three/drei'
import * as THREE from 'three'
import { FLOOR_HEIGHT, SLAB_THICKNESS, floorY } from './constants'
import { roomCells } from './layout'

const OVERVIEW_POS = [95, 80, 110]
const VIEW_DIR = new THREE.Vector3(0.55, 0.5, 0.85).normalize() // front-right, above

// Where the camera should be for the current selection: [camera xyz, target xyz].
function frameFor(selection, buildings, detail, overviewTarget) {
  const b = buildings.find((x) => x.id === selection.buildingId)
  if (!b) return [OVERVIEW_POS, overviewTarget, true]

  const count = Math.max(1, b.floors)
  const { x, z } = b.position

  const floor = detail?.id === b.id ? detail.floors?.find((f) => f.id === selection.floorId) : null
  const cells = floor ? roomCells(floor.rooms.length, b.size) : []
  const roomIdx = floor ? floor.rooms.findIndex((r) => r.id === selection.roomId) : -1

  if (floor && roomIdx >= 0) {
    // Frame the selected room (exploded floor height is the end state of the animation).
    const cell = cells[roomIdx]
    const t = [x + cell.x, floorY(floor.level, 1) + SLAB_THICKNESS + 1.2, z + cell.z]
    const dist = Math.max(20, Math.max(cell.w, cell.d) * 1.6)
    return [t.map((v, i) => v + VIEW_DIR.getComponent(i) * dist), t, false]
  }

  // Frame the whole exploded building.
  const totalH = floorY(count, 1) + FLOOR_HEIGHT
  const t = [x, totalH / 2, z]
  const dist = Math.max(b.size.w, b.size.d, totalH) * 1.25 + 18
  return [t.map((v, i) => v + VIEW_DIR.getComponent(i) * dist), t, false]
}

// Camera controls that fly to whatever the selection points at (works for outside changes too).
export default function CameraRig({ buildings, buildingDetail, selection, overviewTarget }) {
  const controls = useRef()
  const latest = useRef({ buildings, buildingDetail, overviewTarget })
  const first = useRef(true)

  // Keep the newest data without re-flying the camera every time data refreshes.
  useEffect(() => {
    latest.current = { buildings, buildingDetail, overviewTarget }
  })

  const { buildingId, floorId, roomId } = selection
  const detailId = buildingDetail?.id ?? null

  useEffect(() => {
    const c = controls.current
    if (!c) return
    const { buildings: bs, buildingDetail: det, overviewTarget: ov } = latest.current
    const [pos, tgt] = frameFor({ buildingId, floorId, roomId }, bs, det, ov)
    c.setLookAt(...pos, ...tgt, !first.current)
    first.current = false
  }, [buildingId, floorId, roomId, detailId])

  return (
    <CameraControls
      ref={controls}
      makeDefault
      smoothTime={0.45}
      draggingSmoothTime={0.12}
      minDistance={12}
      maxDistance={260}
      maxPolarAngle={Math.PI / 2.15} // can't go under the ground
    />
  )
}
