/**
 * Stage 4 of hand control: turn gesture commands into camera movement.
 *
 * Mounted INSIDE the <Canvas>, next to Rishi's <CameraRig>. CameraControls
 * exposes `makeDefault`, so `useThree().controls` is the same instance his rig
 * flies around — meaning a hand gesture and a building click fight over the
 * same camera instead of two cameras drifting apart.
 *
 * camera-controls already gives us exactly the verbs we need, so there is no
 * spherical maths here:
 *   rotate(azimuth, polar)  orbit around the target
 *   dolly(distance)         zoom in / out
 *   truck(x, y)             pan in the screen plane
 *
 * Commands arrive through a ref, not state: gestures fire many times per second
 * and re-rendering the whole scene each time would wreck the frame rate.
 */

import { useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export default function GestureCameraBridge({ commandRef, onPick }) {
  const { camera, controls, scene } = useThree()

  const raycaster = useRef(new THREE.Raycaster())
  const ndc = useRef(new THREE.Vector2())
  // last command we actually applied, so a single gesture frame is not replayed
  const appliedAt = useRef(0)
  // camera-controls animates each call over `smoothTime`. Firing one every frame
  // (60/s) starts overlapping transitions and the camera stutters, so we only
  // accept a new move every MOVE_INTERVAL seconds — still smoother than a hand
  // can move, and well below the frame rate.
  const lastMove = useRef(0)
  const MOVE_INTERVAL = 1 / 30

  useFrame((state) => {
    const cmd = commandRef?.current
    if (!cmd || !controls) return
    if (cmd.at === appliedAt.current) return // already applied this command
    appliedAt.current = cmd.at

    const moving = cmd.name === 'orbit' || cmd.name === 'pan' || cmd.name === 'zoom'
    if (moving) {
      if (state.clock.elapsedTime - lastMove.current < MOVE_INTERVAL) return
      lastMove.current = state.clock.elapsedTime
    }

    if (cmd.name === 'orbit') {
      const [dx, dy] = cmd.arg
      // camera-controls takes radians per call; scale the palm delta down so one
      // frame of hand movement is a small nudge, not a lurch
      controls.rotate(-dx * 0.6, -dy * 0.4, false)
    } else if (cmd.name === 'pan') {
      const [dx, dy] = cmd.arg
      controls.truck(-dx * 12, dy * 12, false)
    } else if (cmd.name === 'zoom') {
      // arg < 1 means "zoom in"; dolly takes a signed world-space step, so scale
      // that step by how far away we currently are -- a fixed 40 units would
      // slam the camera into a building when you are already close.
      const factor = cmd.arg
      const dist = camera.position.distanceTo(controls.target)
      controls.dolly((1 - factor) * dist * 0.6, false)
    } else if (cmd.name === 'select') {
      const [x, y] = cmd.arg
      ndc.current.set(x * 2 - 1, -(y * 2 - 1))
      raycaster.current.setFromCamera(ndc.current, camera)
      const hits = raycaster.current.intersectObjects(scene.children, true)

      // preferred: a building group declaring userData.entityId (Rishi to add).
      // fallback: report the hit point so nothing breaks before that lands.
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
  })

  return null
}
