/**
 * Small on-screen panel: webcam preview, current gesture, and the toggle.
 *
 * Deliberately shows the preview -- presenters need to see whether their hand
 * is actually in frame before they start waving at a projector.
 */

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

export default function GestureOverlay({ enabled, onToggle, gesture, error, ready, videoRef }) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggle}
        className="pointer-events-auto self-start rounded-md border border-white/15 bg-black/60 px-2.5 py-1 text-xs font-medium text-slate-200 backdrop-blur hover:bg-black/80"
      >
        {enabled ? 'Hand control: on' : 'Hand control: off'}
      </button>

      {enabled && (
        <div className="w-52 overflow-hidden rounded-md border border-white/15 bg-black/70 backdrop-blur">
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
            {enabled && ready && !error && (
              <span className="ml-auto shrink-0 text-[10px] text-emerald-400">live</span>
            )}
          </div>
          {error && <p className="px-2 pb-2 text-[10px] leading-snug text-amber-400">{error}</p>}
        </div>
      )}
    </div>
  )
}
