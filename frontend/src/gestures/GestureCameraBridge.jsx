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

/**
 * How far the camera moves per unit of palm movement. Tuned by feel: too low and
 * panning appears to do nothing, too high and the campus flies off screen.
 */
const GAIN = {
  rotate: 0.6,   // radians per palm delta
  pan: 90,       // world units per palm delta
  zoom: 0.6,     // fraction of current distance per (1 - factor)
}

export default function GestureCameraBridge({ commandRef, onPick, buildings = null }) {
  const { camera, controls, scene } = useThree()

  const raycaster = useRef(new THREE.Raycaster())
  const ndc = useRef(new THREE.Vector2())
  const appliedAt = useRef(0)

  // Accumulated motion since the last frame. Applied once, then cleared.
  const pending = useRef({ orbit: [0, 0], pan: [0, 0], dolly: 0 })

  /**
   * The building closest to whatever the camera is looking at. Used by the peace
   * gesture, which has no pointer to raycast from.
   */
  function nearestBuilding(cam, target, list) {
    if (!list?.length) return null
    const focus = target ?? cam.position
    let best = null
    let bestD = Infinity
    for (const b of list) {
      // layout.js gives buildings `position: { x, z }`, not a vector.
      const pos = b.position ?? b.center ?? {}
      const x = pos.x ?? 0
      const z = pos.z ?? 0
      const d = (x - focus.x) ** 2 + (z - focus.z) ** 2
      if (d < bestD) {
        bestD = d
        best = b
      }
    }
    return best
  }

  /**
   * Raycast from the fingertip: the same thing a mouse click would do.
   * (The peace gesture uses nearestBuilding above, since it has no pointer.)
   */
  function pick([x, y]) {
    ndc.current.set(x * 2 - 1, -(y * 2 - 1))
    raycaster.current.setFromCamera(ndc.current, camera)
    const hits = raycaster.current.intersectObjects(scene.children, true)

    // Preferred: an object (or ancestor) declaring userData.entityId. Rishi can
    // add that to the building group at any time and this picks it up first.
    for (const hit of hits) {
      let node = hit.object
      while (node && !node.userData?.entityId) node = node.parent
      if (node?.userData?.entityId) {
        onPick?.(node.userData.entityId)
        return
      }
    }

    // Fallback while that lands: work out which building was hit from its
    // position. Buildings are axis-aligned boxes on the known campus layout, so
    // a simple point-in-footprint test is exact and needs nothing from Rishi.
    if (hits.length && buildings?.length) {
      const p = hits[0].point
      const b = buildings.find(
        (bld) =>
          Math.abs(p.x - bld.position.x) <= bld.size.w / 2 + 0.5 &&
          Math.abs(p.z - bld.position.z) <= bld.size.d / 2 + 0.5,
      )
      onPick?.(b ? b.id : null)
      return
    }

    onPick?.(null)
  }

  // track whether commands are arriving but being ignored, so the HUD can say so
  const seen = useRef({ commands: 0, applied: 0, noControls: 0 })

  useFrame(() => {
    const cmd = commandRef?.current
    if (cmd && cmd.at !== appliedAt.current) seen.current.commands += 1
    if (!controls) {
      if (cmd) seen.current.noControls += 1
      return
    }

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
        pending.current.dolly += (1 - cmd.arg) * dist * GAIN.zoom
      } else if (cmd.name === 'select') {
        pick(cmd.arg)
      } else if (cmd.name === 'toggle_explode') {
        // Rishi's Building component explodes its floors whenever it is the
        // selected building -- there is no separate "explode" flag to flip. So
        // the gesture does what clicking a building does: select the nearest one
        // (exploding it), or step back out if something is already selected.
        if (onPick) {
          const target = nearestBuilding(camera, controls?.target, buildings)
          onPick(target ? (target.id ?? target) : null, 'toggle_explode')
        }
      }
    }

    // ---- 2. drain the accumulated motion ----
    const p = pending.current
    if (p.orbit[0] || p.orbit[1]) {
      controls.rotate(-p.orbit[0] * GAIN.rotate, -p.orbit[1] * GAIN.rotate * 0.7, false)
      p.orbit[0] = 0
      p.orbit[1] = 0
    }
    if (p.pan[0] || p.pan[1]) {
      controls.truck(-p.pan[0] * GAIN.pan, p.pan[1] * GAIN.pan, false)
      p.pan[0] = 0
      p.pan[1] = 0
    }
    if (p.dolly) {
      controls.dolly(p.dolly, false)
      p.dolly = 0
    }
    seen.current.applied = seen.current.commands
    globalThis.__gestureBridge = seen.current
  })

  return null
}
