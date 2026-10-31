/**
 * The hook that joins stages 1 -> 2 -> 3 and exposes the current gesture for the HUD.
 *
 * Commands go out through a ref, not React state, because they fire many times
 * per second and re-rendering the campus on every one would tank the frame rate.
 * Only the gesture *name* (for the on-screen badge) is state, and it changes a
 * few times a minute.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { HandTracker } from './handTracker.js'
import { GestureController } from './GestureController.js'
import { classify, fingerScores } from './classify.js'

export function useHandGestures({ enabled = false, videoRef, onCommand } = {}) {
  const [gesture, setGesture] = useState('none')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [debug, setDebug] = useState(false)
  /** Fingertip position while pointing, in 0..1 screen space, or null. */
  const [cursorPos, setCursorPos] = useState(null)
  const cursorRef = useRef(null)

  // `__gestureDebug(true)` in the console turns the diagnostics panel on.
  useEffect(() => {
    globalThis.__gestureDebug = (on = true) => setDebug(Boolean(on))
    return () => {
      delete globalThis.__gestureDebug
    }
  }, [])

  /** Latest command for GestureCameraBridge. `{name, arg}` or null. */
  /** Queue of unconsumed camera commands; the bridge drains it each frame. */
  const commandQueueRef = useRef([])
  let commandSeq = 0
  const commandRef = commandQueueRef
  const controllerRef = useRef(null)
  const trackerRef = useRef(null)
  const onCommandRef = useRef(onCommand)

  // keep the callback fresh without assigning a ref during render
  useEffect(() => {
    onCommandRef.current = onCommand
  }, [onCommand])

  const send = useCallback((name, arg) => {
    // `cursor` is the fingertip position while pointing. It is not a camera
    // command, so it goes out on its own channel and the HUD draws a reticle
    // from it -- otherwise the point gesture is invisible and looks broken.
    if (name === 'cursor') {
      cursorRef.current = arg
      setCursorPos(arg)
      return
    }
    // A QUEUE, not a single slot.
    //
    // The controller can emit two commands on one frame -- a fist sends `pan`
    // and then `zoom` from the same branch. With one slot the second overwrote
    // the first before the render loop ever read it, so pan silently vanished
    // whenever zoom also fired. That is why pan felt slow and zoom felt broken
    // no matter what the gains were set to.
    const q = commandQueueRef.current
    q.push({ name, arg, id: ++commandSeq })
    if (q.length > 64) q.splice(0, q.length - 64) // never grow unbounded
    onCommandRef.current?.(name, arg)
  }, [])

  useEffect(() => {
    if (!enabled) {
      trackerRef.current?.stop()
      trackerRef.current = null
      const clear = setTimeout(() => setReady(false), 0)
      return () => clearTimeout(clear)
    }

    const video = videoRef.current
    if (!video) return undefined

    // Commands go out through a ref (many per second, no re-render). The HUD
    // needs the gesture *name*, which only changes a few times a second, so it
    // goes through React state -- including orbit/pan/zoom, so the badge always
    // shows what the hand is actually doing.
    controllerRef.current = new GestureController((name, arg) => {
      send(name, arg)
      // keep a short log for the debug overlay
      const c = controllerRef.current
      if (c && name !== 'cursor') {
        c.history.unshift({ name, arg, at: Date.now() })
        if (c.history.length > 20) c.history.length = 20
      }
    })

    // `__gestureCapture()` freezes the next frame's raw landmarks so they can be
    // pasted into a bug report. Landmark dumps are the only way to tell whether
    // a gesture is failing in the classifier or before it.
    let captureNext = false
    globalThis.__gestureCapture = () => {
      captureNext = true
      return 'capturing -- hold your hand up now'
    }

    const tracker = new HandTracker({
      video,
      onHands: (hands) => {
        if (captureNext && hands.length) {
          captureNext = false
          globalThis.__gestureCaptureResult = {
            hands: hands.length,
            landmarks: hands.map((h) => h.map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)])),
            scores: hands.map((h) => fingerScores(h).map((v) => +v.toFixed(3))),
            classified: hands.map((h) => classify(h)),
          }
          console.log('[gestures] captured:', globalThis.__gestureCaptureResult)
        }
        const g = controllerRef.current?.update(hands)
        // Type __gestureDebug(true) in the browser console to see what MediaPipe
        // reports and which gesture the classifier chose -- the fastest way to
        // tell a detection problem from a camera problem.
        if (globalThis.__GESTURE_DEBUG__) {
          console.log('[gestures]', {
            hands: hands.length,
            gesture: g,
            stable: controllerRef.current?.stable,
          })
        }
        // React only re-renders when the name actually changes
        if (g !== undefined) setGesture((prev) => (prev === g ? prev : g))
      },
      onError: (msg) => {
        setError(msg)
        setReady(false)
      },
    })
    trackerRef.current = tracker

    tracker.start().then(() => {
      if (tracker.running) setReady(true)
    })

    return () => {
      tracker.stop()
      trackerRef.current = null
      commandRef.current = null
    }
  }, [enabled, videoRef, send])

  return { gesture, error, ready, commandRef, commandQueueRef, controllerRef, debug, setDebug, cursorPos }
}
