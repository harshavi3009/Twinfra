/**
 * The hand-control toggle and HUD.
 *
 * Two separate pieces on purpose:
 *   - <GestureToggleButton />  always visible, so you can turn hand control on
 *   - <GestureHud />           only mounts while hand control is on, so the
 *                              <video> element does not exist until it is needed
 *
 * The HUD keeps the webcam preview because presenters need to see whether their
 * hand is actually in frame before they start waving at a projector.
 */

import { useEffect, useState } from 'react'
import { GESTURE_LABEL } from './classify.js'

const DOT = {
  open: 'bg-emerald-400',
  fist: 'bg-sky-400',
  pinch: 'bg-fuchsia-400',
  point: 'bg-slate-300',
  peace: 'bg-amber-400',
  three: 'bg-amber-400',
  thumbs_up: 'bg-amber-400',
  call: 'bg-amber-400',
  zoom: 'bg-emerald-400',
  none: 'bg-slate-600',
  unknown: 'bg-slate-600',
}

const HAND = '\u270B' // ✋

export function GestureToggleButton({ enabled, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={enabled ? 'Turn hand control off (G)' : 'Turn hand control on (G)'}
      aria-pressed={enabled}
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium backdrop-blur transition ${
        enabled
          ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
          : 'border-white/15 bg-black/60 text-slate-300 hover:bg-black/80'
      }`}
    >
      <span aria-hidden="true">{HAND}</span>
      <span>Hand control</span>
      <span
        className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-emerald-400' : 'bg-slate-500'}`}
      />
    </button>
  )
}

export function GestureHud({ gesture, error, ready, videoRef, controllerRef, debug, onDebugToggle, cursorPos }) {
  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-10 w-52 overflow-hidden rounded-md border border-white/15 bg-black/75 backdrop-blur">
      <video
        ref={videoRef}
        className="h-36 w-full scale-x-[-1] object-cover"
        playsInline
        muted
      />
      <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-200">
        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[gesture] || DOT.none}`} />
        <span className="truncate">
          {error ? 'Camera unavailable' : GESTURE_LABEL[gesture] || GESTURE_LABEL.unknown}
        </span>
        {ready && !error && (
          <span className="ml-auto shrink-0 text-[10px] text-emerald-400">live</span>
        )}
      </div>
      {error && <p className="px-2 pb-2 text-[10px] leading-snug text-amber-400">{error}</p>}
      <label className="flex cursor-pointer items-center gap-1.5 border-t border-white/10 px-2 py-1 text-[10px] text-slate-400">
        <input
          type="checkbox"
          checked={Boolean(debug)}
          onChange={(e) => onDebugToggle?.(e.target.checked)}
          className="h-3 w-3 accent-emerald-400"
        />
        diagnostics
      </label>
      {debug && <DebugRows controllerRef={controllerRef} />}
      <FingerReticle pos={cursorPos} />
    </div>
  )
}

/**
 * A dot under the fingertip while pointing. Without it the point gesture is
 * completely invisible -- it emits no camera command, so the screen gives no
 * feedback at all and it reads as broken.
 */
function FingerReticle({ pos }) {
  if (!pos) return null
  return (
    <div
      className="pointer-events-none fixed z-40"
      style={{
        left: `${pos[0] * 100}%`,
        top: `${pos[1] * 100}%`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div className="h-4 w-4 rounded-full border-2 border-emerald-400/90 bg-emerald-400/30" />
    </div>
  )
}

/**
 * Live diagnostics. Enable with `__gestureDebug(true)` in the console (or the
 * checkbox in the HUD). It answers the only three questions that matter when a
 * gesture does nothing:
 *   1. does the classifier see the pose I am making?
 *   2. is the controller emitting a command for it?
 *   3. is the camera receiving it?
 */
function DebugRows({ controllerRef }) {
  // The controller is a plain object mutated every frame, so read it on a timer
  // rather than during render (React should not see refs change mid-render).
  const [snap, setSnap] = useState(null)
  useEffect(() => {
    const id = setInterval(() => {
      const c = controllerRef?.current
      if (!c) return
      setSnap({
        stable: c.stable,
        raw: c.lastRaw,
        ratios: c.lastRatios,
        history: c.history.slice(0, 4),
      })
    }, 250)
    return () => clearInterval(id)
  }, [controllerRef])
  const c = snap
  const recent = c?.history ?? []
  const ratios = c?.ratios
  return (
    <div className="border-t border-white/10 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-slate-400">
      <div>
        stable <span className="text-slate-200">{c?.stable ?? '-'}</span>
        {'  '}raw <span className="text-slate-200">{c?.lastRaw ?? '-'}</span>
      </div>
      {ratios && <div>ratios {ratios.map((r) => r.toFixed(2)).join(' ')}</div>}
      <div className="mt-1 text-slate-500">last commands</div>
      {recent.length === 0 && <div className="text-amber-400">none yet</div>}
      {recent.map((h, i) => (
        <div key={`${h.at}-${i}`} className="text-slate-300">
          {h.name}
          {Array.isArray(h.arg) ? ` [${h.arg.map((v) => v.toFixed(3)).join(', ')}]` : ''}
        </div>
      ))}
    </div>
  )
}

/** Kept for callers that want the old single component. */
export default function GestureOverlay(props) {
  return (
    <>
      <GestureToggleButton enabled={props.enabled} onToggle={props.onToggle} />
      {props.enabled && <GestureHud {...props} />}
    </>
  )
}
