import { useRef, useState } from 'react'
import { getAlerts, getCampus } from '../api/client.js'
import DrillDownPanel from '../components/DrillDownPanel.jsx'
import EntityCharts from '../components/EntityCharts.jsx'
import KpiStrip from '../components/KpiStrip.jsx'
import { usePolling } from '../hooks/usePolling.js'
import { Campus3D } from '../campus3d/index.jsx'
import GestureOverlay from '../gestures/GestureOverlay.jsx'
import { useHandGestures } from '../gestures/useHandGestures.js'

export default function Overview() {
  const { data: campus, error } = usePolling(getCampus)
  const { data: alerts } = usePolling(() => getAlerts(true))
  // Selection state lives here; the 3D view and the right panel both use it.
  const [selection, setSelection] = useState({
    buildingId: null,
    floorId: null,
    roomId: null,
    equipmentId: null,
  })

  // Hand control is off until the presenter turns it on. The demo must never
  // depend on a webcam working.
  const [handControl, setHandControl] = useState(false)
  const videoRef = useRef(null)

  const selectEntity = (id) => {
    if (!id || typeof id !== 'string') return
    const [b, f, r] = id.split('-')
    if (id.startsWith('EQ-')) return
    setSelection({
      buildingId: b,
      floorId: f ? `${b}-${f}` : null,
      roomId: r ? id : null,
      equipmentId: null,
    })
  }

  const { gesture, error: gestureError, ready, commandRef } = useHandGestures({
    enabled: handControl,
    videoRef,
    onCommand: (name, arg) => {
      // keep the side panel in step with what the hand selects
      if (name === 'select' && arg) selectEntity(arg)
    },
  })

  if (!campus) {
    return error ? (
      <p className="text-critical">Could not load campus: {error}</p>
    ) : (
      <p className="text-muted">Loading…</p>
    )
  }

  // Alert entity ids look like B1 / B1-F1-R01 / EQ-0042: select as deep as we can tell.
  const selectAlert = (id) => selectEntity(id)

  return (
    <div className="flex flex-col gap-4">
      <KpiStrip totals={campus.totals} alerts={alerts} />
      <div className="flex h-[520px] gap-4">
        <div className="relative min-w-0 flex-1">
          <Campus3D
            campus={campus}
            selection={selection}
            onSelect={setSelection}
            gestureCommand={handControl ? commandRef : null}
            onGesturePick={selectEntity}
          />
          <GestureOverlay
            enabled={handControl}
            onToggle={() => setHandControl((v) => !v)}
            gesture={gesture}
            error={gestureError}
            ready={ready}
            videoRef={videoRef}
          />
        </div>
        <aside className="w-96 shrink-0 overflow-auto">
          <DrillDownPanel
            campus={campus}
            alerts={alerts}
            selection={selection}
            onSelect={setSelection}
            onAlertSelect={selectAlert}
          />
        </aside>
      </div>
      <EntityCharts entityId={selection.equipmentId || selection.roomId || selection.buildingId} />
    </div>
  )
}
