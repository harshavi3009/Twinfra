import { useState } from 'react'
import { getAlerts, getCampus } from '../api/client.js'
import DrillDownPanel from '../components/DrillDownPanel.jsx'
import EntityCharts from '../components/EntityCharts.jsx'
import KpiStrip from '../components/KpiStrip.jsx'
import { usePolling } from '../hooks/usePolling.js'
import { Campus3D } from '../campus3d/index.jsx'

export default function Overview() {
  const { data: campus, error } = usePolling(getCampus)
  const { data: alerts } = usePolling(() => getAlerts(true))
  // Selection state lives here; the 3D view and the right panel both use it.
  const [selection, setSelection] = useState({ buildingId: null, floorId: null, roomId: null, equipmentId: null })

  if (!campus) {
    return error ? <p className="text-critical">Could not load campus: {error}</p> : <p className="text-muted">Loading…</p>
  }

  // Alert entity ids look like B1 / B1-F1-R01 / EQ-0042: select as deep as we can tell.
  const selectEntity = (id) => {
    const [b, f, r] = id.split('-')
    if (id.startsWith('EQ-')) return
    setSelection({
      buildingId: b,
      floorId: f ? `${b}-${f}` : null,
      roomId: r ? id : null,
      equipmentId: null,
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <KpiStrip totals={campus.totals} alerts={alerts} />
      <div className="flex h-[520px] gap-4">
        <div className="min-w-0 flex-1">
          <Campus3D campus={campus} selection={selection} onSelect={setSelection} />
        </div>
        <aside className="w-96 shrink-0 overflow-auto">
          <DrillDownPanel
            campus={campus}
            alerts={alerts}
            selection={selection}
            onSelect={setSelection}
            onAlertSelect={selectEntity}
          />
        </aside>
      </div>
      <EntityCharts entityId={selection.equipmentId || selection.roomId || selection.buildingId} />
    </div>
  )
}
