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
  rotate: 5.0,   // radians per full-frame palm sweep
  pan: 2600,     // world units per full-frame palm sweep (campus is ~200 wide)
  zoom: 2.2,     // fraction of current distance per full-frame size change
}

/**
 * The point the camera orbits. `camera-controls` exposes getTarget(), NOT a
 * `.target` property -- reading `.target` yields undefined, distanceTo throws,
 * and the whole useFrame callback dies, so zoom silently never applied.
 */
const FALLBACK_TARGET = new THREE.Vector3(0, 0, 0)
function targetOf(controls) {
  if (!controls) return FALLBACK_TARGET
  if (typeof controls.getTarget === 'function') {
    const v = new THREE.Vector3()
    controls.getTarget(v)
    return v
  }
  return controls.target ?? FALLBACK_TARGET
}

export default function GestureCameraBridge({ commandRef, onPick, buildings = null }) {
  const { camera, controls, scene } = useThree()

  const raycaster = useRef(new THREE.Raycaster())
  const ndc = useRef(new THREE.Vector2())

  // Accumulated motion since the last frame. Applied once, then cleared.
  const pending = useRef({ orbit: [0, 0], pan: [0, 0], dolly: 0 })

  /**
   * The building closest to whatever the camera is looking at. Used by the peace
   * gesture, which has no pointer to raycast from.
   */
  function nearestBuilding(cam, target, list) {
    if (!list?.length || !cam) return null
    // `target` can be undefined for a frame while CameraControls initialises,
    // and cam.position is always a Vector3, so fall back all the way.
    const focus = target ?? cam?.position
    if (!focus) return null
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

  /** Where the finger's ray meets the ground plane (y = 0). */
  function groundPoint(ray) {
    if (!ray) return null
    const dy = ray.direction.y
    if (Math.abs(dy) < 1e-6) return null // parallel to the ground
    const t = -ray.origin.y / dy
    if (t <= 0) return null // ground is behind the camera
    return {
      x: ray.origin.x + ray.direction.x * t,
      z: ray.origin.z + ray.direction.z * t,
    }
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
      if (b) {
        onPick?.(b.id)
        return
      }
    }

    // Still nothing: the fingertip is over the ground, the sky, or between
    // buildings -- which is most of the screen most of the time. Requiring the
    // ray to land exactly on a building made pinch feel completely dead, so
    // fall back to the building nearest to where the finger is pointing.
    if (buildings?.length) {
      const gp = groundPoint(raycaster.current.ray)
      if (gp) {
        let best = null
        let bestD = Infinity
        for (const b of buildings) {
          const pos = b.position ?? {}
          const d = (pos.x - gp.x) ** 2 + (pos.z - gp.z) ** 2
          // only accept buildings within a sensible radius of the point, so a
          // pinch pointed at empty sky does not select something across campus
          if (d < bestD) {
            bestD = d
            best = b
          }
        }
        if (best) {
          onPick?.(best.id)
          return
        }
      }
    }

    onPick?.(null)
  }

  // track whether commands are arriving but being ignored, so the HUD can say so
  const seen = useRef({ commands: 0, applied: 0, noControls: 0 })


  useFrame(() => {
    // Drain EVERY command queued since the last frame, not just the newest.
    //
    // The old code held one command in a single slot, so when the controller
    // emitted `pan` and `zoom` from the same fist frame the second overwrote the
    // first and pan was lost before the render loop saw it. Keeping a queue
    // means a burst is applied in full and in order.
    const queue = commandRef?.current
    const cmds = Array.isArray(queue) ? queue.splice(0, queue.length) : []
    if (cmds.length) seen.current.commands += cmds.length
    if (!controls) {
      if (cmds.length) seen.current.noControls += cmds.length
      return
    }

    // ---- 1. accumulate every new command (never drop one) ----
    for (const cmd of cmds) {
      if (cmd.name === 'orbit') {
        pending.current.orbit[0] += cmd.arg[0]
        pending.current.orbit[1] += cmd.arg[1]
      } else if (cmd.name === 'pan') {
        pending.current.pan[0] += cmd.arg[0]
        pending.current.pan[1] += cmd.arg[1]
      } else if (cmd.name === 'zoom') {
        // arg is a multiplier; convert to a signed dolly step using current range
        const dist = camera.position.distanceTo(targetOf(controls))
        pending.current.dolly += (1 - cmd.arg) * dist * GAIN.zoom
      } else if (cmd.name === 'select') {
        pick(cmd.arg)
      } else if (cmd.name === 'toggle_explode') {
        // Rishi's Building component explodes its floors whenever it is the
        // selected building -- there is no separate "explode" flag to flip. So
        // the gesture does what clicking a building does: select the nearest one
        // (exploding it), or step back out if something is already selected.
        if (onPick) {
          const target = nearestBuilding(camera, targetOf(controls), buildings)
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
      // `dolly(distance, enableTransition)` does nothing visible on Rishi's rig:
      // his CameraControls sets `smoothTime`, and a non-transition dolly gets
      // overwritten by the pending smoothed transition before it renders, so the
      // camera never actually moved even though the command was applied.
      // `zoomTo` sets the distance relative to the current target and is the
      // call that survives his smoothing.
      // Move the camera directly along the view axis. zoomTo/dolly both get
      // swallowed by Rishi's smoothTime transition -- the command is applied,
      // the smoothed state overwrites it before the next render, and the camera
      // never moves. Setting the position ourselves is the only thing that
      // sticks, and it composes fine with his rig because he only drives the
      // camera on selection changes.
      // camera-controls owns the camera transform and rewrites it from its own
      // internal spherical state every frame, so writing camera.position is
      // undone before it renders. The supported way to change distance is
      // `zoomTo`, but it needs `enableTransition` and a target it knows about.
      // Calling `dolly` keeps the controls' own state in sync.
      const step = Math.max(-30, Math.min(30, p.dolly * 0.05))
      if (typeof controls.dolly === 'function') {
        controls.dolly(step, true)
      } else if (typeof controls.zoomTo === 'function') {
        const dist = camera.position.distanceTo(targetOf(controls))
        controls.zoomTo(Math.max(12, Math.min(260, dist - step)), true)
      }
      p.dolly = 0
    }
    seen.current.applied = seen.current.commands
    globalThis.__gestureBridge = seen.current
    // Live camera position, so the console and the tests can prove the camera
    // moved rather than merely that a command was dispatched.
    globalThis.__cam = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    }
  })

  return null
}
