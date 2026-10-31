import { useEffect, useState } from 'react'
import { getAlerts, getBuilding, getCampus, getConnections, getImpact, getRoom } from '../api/client.js'
import CreateTicketModal from '../components/CreateTicketModal.jsx'
import DrillDownPanel from '../components/DrillDownPanel.jsx'
import EntityCharts from '../components/EntityCharts.jsx'
import KpiStrip from '../components/KpiStrip.jsx'
import { usePolling } from '../hooks/usePolling.js'
import { Campus3D } from '../campus3d/index.jsx'

export default function Overview() {
  const { data: campus, error } = usePolling(getCampus)
  const { data: alerts } = usePolling(() => getAlerts(true))
  const { data: connections } = usePolling(getConnections)
  // Selection state lives here; the 3D view and the right panel both use it.
  const [selection, setSelection] = useState({ buildingId: null, floorId: null, roomId: null, equipmentId: null })
  // 3D controls: day/night, and the "what if the substation fails" impact result.
  const [timeOfDay, setTimeOfDay] = useState('day')
  const [highlightIds, setHighlightIds] = useState([])
  const [impactNote, setImpactNote] = useState('')
  const runImpact = () =>
    getImpact('UT-SUB')
      .then((r) => {
        setHighlightIds(r.affected.ids)
        setImpactNote(`Substation fails: ${r.affected.rooms} rooms and ${r.affected.equipment} equipment affected`)
      })
      .catch(() => {})
  const clearImpact = () => {
    setHighlightIds([])
    setImpactNote('')
  }
  // Set when "Create ticket" is clicked on an asset card; the form opens prefilled with that equipment.
  const [newTicket, setNewTicket] = useState(null)

  // Detail for the 3D drill-down (rooms of the selected building, equipment of the selected room).
  // Campus3D ignores a detail whose id doesn't match the selection, so stale values are harmless.
  const [buildingDetail, setBuildingDetail] = useState(null)
  const [roomDetail, setRoomDetail] = useState(null)
  useEffect(() => {
    if (!selection.buildingId) return
    let cancelled = false
    getBuilding(selection.buildingId).then((d) => !cancelled && setBuildingDetail(d)).catch(() => {})
    return () => { cancelled = true }
  }, [selection.buildingId])
  useEffect(() => {
    if (!selection.roomId) return
    let cancelled = false
    getRoom(selection.roomId).then((d) => !cancelled && setRoomDetail(d)).catch(() => {})
    return () => { cancelled = true }
  }, [selection.roomId])

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
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="rounded border px-3 py-1" onClick={highlightIds.length ? clearImpact : runImpact}>
          {highlightIds.length ? 'Clear impact' : 'What if the substation fails?'}
        </button>
        <button
          type="button"
          className="rounded border px-3 py-1"
          onClick={() => setTimeOfDay((t) => (t === 'day' ? 'night' : 'day'))}
        >
          {timeOfDay === 'day' ? 'Day (click for night)' : 'Night (click for day)'}
        </button>
        {impactNote && <span className="text-critical">{impactNote}</span>}
        <span className="text-muted">Click the substation or water tank on the map to show its lines.</span>
      </div>
      <div className="flex h-[520px] gap-4">
        <div className="min-w-0 flex-1">
          <Campus3D
            campus={campus}
            selection={selection}
            onSelect={setSelection}
            buildingDetail={buildingDetail}
            roomDetail={roomDetail}
            connections={connections}
            highlightIds={highlightIds}
            timeOfDay={timeOfDay}
          />
        </div>
        <aside className="w-96 shrink-0 overflow-auto">
          <DrillDownPanel
            campus={campus}
            alerts={alerts}
            selection={selection}
            onSelect={setSelection}
            onAlertSelect={selectEntity}
            onCreateTicket={(eq) =>
              setNewTicket({ entityId: eq.room_id, equipmentId: eq.id, title: `${eq.name}: needs attention` })
            }
          />
        </aside>
      </div>
      <EntityCharts entityId={selection.equipmentId || selection.roomId || selection.buildingId} />
      {newTicket && (
        <CreateTicketModal
          entityId={newTicket.entityId}
          equipmentId={newTicket.equipmentId}
          title={newTicket.title}
          onClose={() => setNewTicket(null)}
          onCreated={() => setNewTicket(null)}
        />
      )}
    </div>
  )
}
