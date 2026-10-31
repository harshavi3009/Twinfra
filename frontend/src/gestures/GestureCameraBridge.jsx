/**
 * Stage 4 of hand control: turn gesture commands into camera movement.
 *
 * Mounted INSIDE the <Canvas>, next to Rishi's <CameraRig>. CameraControls
 * exposes `makeDefault`, so `useThree().controls` is the same instance his rig
 * flies around — a hand gesture and a building click drive one camera instead of
 * two drifting apart.
 *
 * camera-controls already has the verbs we need, so there is no spherical maths:
 *   rotate(azimuth, polar)  orbit around the target
 *   dolly(distance)         zoom in / out
 *   truck(x, y)             pan in the screen plane
 *
 * Two things this file has to get right, both learned the hard way:
 *
 *  1. Every command must be applied EXACTLY ONCE, even if the frame rate is too
 *     slow to keep up. Commands are accumulated into a pending delta and applied
 *     on the next frame -- never dropped. (Dropping looked like "orbit works,
 *     pan and zoom do nothing", because orbit fires every frame and fills the
 *     gaps while the bursty commands were being thrown away.)
 *
 *  2. `rotate`/`truck`/`dolly` apply immediately -- `smoothTime` on Rishi's rig
 *     only affects transitions and `setLookAt`, so a gesture does not fight his
 *     smoothing. Our own smoothing is the exponential filter in
 *     GestureController, which is what actually stops the camera shaking.
 */

import { useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export default function GestureCameraBridge({ commandRef, onPick }) {
  const { camera, controls, scene } = useThree()

  const raycaster = useRef(new THREE.Raycaster())
  const ndc = useRef(new THREE.Vector2())
  const appliedAt = useRef(0)

  // Accumulated motion since the last frame. Applied once, then cleared.
  const pending = useRef({ orbit: [0, 0], pan: [0, 0], dolly: 0 })

  /** Raycast from the fingertip: the same thing a mouse click would do. */
  function pick([x, y]) {
    ndc.current.set(x * 2 - 1, -(y * 2 - 1))
    raycaster.current.setFromCamera(ndc.current, camera)
    const hits = raycaster.current.intersectObjects(scene.children, true)

    // Preferred: an object (or ancestor) declaring userData.entityId.
    // Fallback: report the hit point so nothing breaks before Rishi adds it.
    let picked = null
    for (const hit of hits) {
      let node = hit.object
      while (node && !node.userData?.entityId) node = node.parent
      if (node?.userData?.entityId) {
        picked = node.userData.entityId
        break
      }
    }
    onPick?.(picked ?? (hits.length ? { position: hits[0].point } : null))
  }

  useFrame(() => {
    const cmd = commandRef?.current
    if (!controls) return

    // ---- 1. accumulate any new command (never drop one) ----
    if (cmd && cmd.at !== appliedAt.current) {
      appliedAt.current = cmd.at

      if (cmd.name === 'orbit') {
        pending.current.orbit[0] += cmd.arg[0]
        pending.current.orbit[1] += cmd.arg[1]
      } else if (cmd.name === 'pan') {
        pending.current.pan[0] += cmd.arg[0]
        pending.current.pan[1] += cmd.arg[1]
      } else if (cmd.name === 'zoom') {
        // arg is a multiplier; convert to a signed dolly step using current range
        const dist = camera.position.distanceTo(controls.target)
        pending.current.dolly += (1 - cmd.arg) * dist * 0.6
      } else if (cmd.name === 'select') {
        pick(cmd.arg)
      }
    }

    // ---- 2. drain the accumulated motion ----
    const p = pending.current
    if (p.orbit[0] || p.orbit[1]) {
      controls.rotate(-p.orbit[0] * 0.6, -p.orbit[1] * 0.4, false)
      p.orbit[0] = 0
      p.orbit[1] = 0
    }
    if (p.pan[0] || p.pan[1]) {
      controls.truck(-p.pan[0] * 12, p.pan[1] * 12, false)
      p.pan[0] = 0
      p.pan[1] = 0
    }
    if (p.dolly) {
      controls.dolly(p.dolly, false)
      p.dolly = 0
    }
  })

  return null
}
