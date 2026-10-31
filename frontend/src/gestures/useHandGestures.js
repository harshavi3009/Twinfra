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

export function useHandGestures({ enabled = false, videoRef, onCommand } = {}) {
  const [gesture, setGesture] = useState('none')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [debug, setDebug] = useState(false)

  // `__gestureDebug(true)` in the console turns the diagnostics panel on.
  useEffect(() => {
    globalThis.__gestureDebug = (on = true) => setDebug(Boolean(on))
    return () => {
      delete globalThis.__gestureDebug
    }
  }, [])

  /** Latest command for GestureCameraBridge. `{name, arg}` or null. */
  const commandRef = useRef(null)
  const controllerRef = useRef(null)
  const trackerRef = useRef(null)
  const onCommandRef = useRef(onCommand)

  // keep the callback fresh without assigning a ref during render
  useEffect(() => {
    onCommandRef.current = onCommand
  }, [onCommand])

  const send = useCallback((name, arg) => {
    if (name === 'cursor') return // nothing to draw yet
    commandRef.current = { name, arg, at: performance.now() }
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

    const tracker = new HandTracker({
      video,
      onHands: (hands) => {
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

  return { gesture, error, ready, commandRef, controllerRef, debug, setDebug }
}
