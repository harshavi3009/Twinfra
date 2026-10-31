/**
 * Stage 4 of hand control: apply gesture commands to the campus camera.
 *
 * Mounted INSIDE the <Canvas> next to <OrbitControls>, because that is the only
 * place `useThree()` can hand us the live camera. `controls` is available
 * because index.jsx gives OrbitControls `makeDefault`.
 *
 * Commands arrive through a ref (not state) on purpose: gestures fire many times
 * per second and React state would re-render the whole scene each time.
 */

import { useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Must match the limits on <OrbitControls> in index.jsx, so the hand cannot put
// the camera somewhere the mouse could not reach.
const MIN_DISTANCE = 25
const MAX_DISTANCE = 260
const MAX_POLAR = Math.PI / 2.15

export default function GestureCameraBridge({ commandRef, onPick }) {
  const { camera, controls, scene } = useThree()
  const spherical = useRef(new THREE.Spherical())
  const offset = useRef(new THREE.Vector3())
  const raycaster = useRef(new THREE.Raycaster())
  const ndc = useRef(new THREE.Vector2())
  const right = useRef(new THREE.Vector3())
  const up = useRef(new THREE.Vector3())

  useFrame(() => {
    const cmd = commandRef?.current
    if (!cmd || !controls) return

    const target = controls.target

    if (cmd.name === 'orbit') {
      const [dx, dy] = cmd.arg
      offset.current.copy(camera.position).sub(target)
      spherical.current.setFromVector3(offset.current)
      spherical.current.theta -= dx * 0.1
      spherical.current.phi -= dy * 0.1
      // clamp exactly like OrbitControls does, or the camera flips under the ground
      spherical.current.phi = Math.max(0.05, Math.min(MAX_POLAR, spherical.current.phi))
      offset.current.setFromSpherical(spherical.current)
      camera.position.copy(target).add(offset.current)
      camera.lookAt(target)
    } else if (cmd.name === 'pan') {
      const [dx, dy] = cmd.arg
      offset.current.copy(camera.position).sub(target)
      const scale = offset.current.length() * 0.02
      right.current.setFromMatrixColumn(camera.matrix, 0)
      up.current.setFromMatrixColumn(camera.matrix, 1)
      // the model follows the hand
      target.addScaledVector(right.current, -dx * scale)
      target.addScaledVector(up.current, dy * scale)
    } else if (cmd.name === 'zoom') {
      const factor = cmd.arg
      offset.current.copy(camera.position).sub(target)
      const next = Math.max(
        MIN_DISTANCE,
        Math.min(MAX_DISTANCE, offset.current.length() * factor),
      )
      camera.position.copy(target).add(offset.current.setLength(next))
    } else if (cmd.name === 'select') {
      // raycast from the fingertip, the same thing a mouse click would do
      const [x, y] = cmd.arg
      ndc.current.set(x * 2 - 1, -(y * 2 - 1))
      raycaster.current.setFromCamera(ndc.current, camera)
      const hits = raycaster.current.intersectObjects(scene.children, true)

      // Preferred: the object (or an ancestor) declares `userData.entityId`.
      // Rishi should add that to the building <group>; until then we fall back
      // to the top-level group, whose position identifies the building.
      for (const h of hits) {
        let node = h.object
        while (node && !node.userData?.entityId) node = node.parent
        if (node?.userData?.entityId) {
          onPick?.(node.userData.entityId)
          break
        }
      }
      if (!hits.length) onPick?.(null)
      else if (!hits.some((h) => {
        let n = h.object
        while (n && !n.userData?.entityId) n = n.parent
        return n?.userData?.entityId
      })) {
        onPick?.({ position: hits[0].point })
      }
    }

    controls.update()
  })

  return null
}
