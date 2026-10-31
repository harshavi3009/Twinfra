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

    controllerRef.current = new GestureController((name, arg) => {
      send(name, arg)
      // the gesture only needs to reach React when the name itself changes
      if (name !== 'cursor' && name !== 'zoom' && name !== 'orbit' && name !== 'pan') {
        setGesture(name)
      }
    })

    const tracker = new HandTracker({
      video,
      onHands: (hands) => {
        const g = controllerRef.current?.update(hands)
        if (g !== undefined) setGesture(g)
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

  return { gesture, error, ready, commandRef }
}
