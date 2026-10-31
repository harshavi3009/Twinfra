import { useState } from 'react'
import { getAlerts, getCampus } from '../api/client.js'
import AlertCard from '../components/AlertCard.jsx'
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

  const selectEntity = (entityId) => {
    // Alert entity ids look like B1 / B1-F1-R01: derive the building from the prefix.
    setSelection({ buildingId: entityId.split('-')[0], floorId: null, roomId: null, equipmentId: null })
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <KpiStrip totals={campus.totals} alerts={alerts} />
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-h-64 min-w-0 flex-1">
          <Campus3D campus={campus} selection={selection} onSelect={setSelection} />
        </div>
        <aside className="flex w-96 shrink-0 flex-col gap-2 overflow-auto">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            {selection.buildingId ? `Selected: ${selection.buildingId}` : 'Top alerts'}
          </h2>
          {(alerts || []).map((a) => (
            <AlertCard key={a.id} alert={a} onSelect={selectEntity} />
          ))}
          {alerts?.length === 0 && <p className="text-sm text-muted">No active alerts.</p>}
        </aside>
      </div>
    </div>
  )
}
