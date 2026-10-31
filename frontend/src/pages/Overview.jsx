import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { getAlerts, getBuilding, getCampus, getConnections, getEquipment, getImpact, getRoom } from '../api/client.js'
import CreateTicketModal from '../components/CreateTicketModal.jsx'
import DrillDownPanel from '../components/DrillDownPanel.jsx'
import EntityCharts from '../components/EntityCharts.jsx'
import KpiStrip from '../components/KpiStrip.jsx'
import { usePolling } from '../hooks/usePolling.js'
import { Campus3D } from '../campus3d/index.jsx'

const EMPTY = { buildingId: null, floorId: null, roomId: null, equipmentId: null }

// The connections graph has building and floor nodes (B1, B1-F2). A room maps to its floor.
const impactNodeFor = (sel) => {
  if (sel.roomId) return sel.roomId.split('-').slice(0, 2).join('-')
  return sel.floorId || sel.buildingId
}

export default function Overview() {
  const { data: campus, error } = usePolling(getCampus)
  const { data: alerts } = usePolling(() => getAlerts(true))
  const { data: connections } = usePolling(getConnections)
  const location = useLocation()
  // Selection state lives here; the 3D view and the right panel both use it.
  const [selection, setSelection] = useState(EMPTY)
  // 3D day/night toggle.
  const [timeOfDay, setTimeOfDay] = useState('day')
  // Set when "Create ticket" is clicked on an asset card; the form opens prefilled with that equipment.
  const [newTicket, setNewTicket] = useState(null)
  // Result of "What if this fails?" for the selected node.
  const [impact, setImpact] = useState(null)
  const [impactError, setImpactError] = useState('')

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

  // Every selection goes through here so a stale impact result is cleared.
  const select = (sel) => {
    setImpact(null)
    setImpactError('')
    setSelection(sel)
  }

  // Alert entity ids look like B1 / B1-F1-R01 / EQ-0042. Select as deep as the id tells us.
  const selectEntity = (id) => {
    if (id.startsWith('EQ-')) {
      getEquipment(id)
        .then((eq) => select({ buildingId: eq.building_id, floorId: null, roomId: eq.room_id, equipmentId: eq.id }))
        .catch(() => {})
      return
    }
    const [b, f, r] = id.split('-')
    select({ buildingId: b, floorId: f ? `${b}-${f}` : null, roomId: r ? id : null, equipmentId: null })
  }

  // The Alerts page links here with the entity to show.
  useEffect(() => {
    if (location.state?.entityId) selectEntity(location.state.entityId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  const impactNode = selection.buildingId ? impactNodeFor(selection) : null
  const runImpact = () => {
    setImpactError('')
    getImpact(impactNode).then(setImpact).catch((e) => setImpactError(e.message))
  }

  if (!campus) {
    return error ? <p className="text-critical">Could not load campus: {error}</p> : <p className="text-muted">Loading…</p>
  }

  return (
    <div className="flex flex-col gap-4">
      <KpiStrip totals={campus.totals} alerts={alerts} />

      <div className="flex min-h-9 flex-wrap items-center justify-between gap-3 text-sm">
        <div>
          {impact && (
            <span className="text-warning">
              If <span className="font-mono text-accent">{impact.id}</span> fails:{' '}
              <strong>{impact.affected.rooms}</strong> rooms and <strong>{impact.affected.equipment}</strong> equipment affected
            </span>
          )}
          {impactError && <span className="text-critical">{impactError}</span>}
          {!impact && !impactError && (
            <span className="text-muted">Click the substation or water tank on the map to show its lines.</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTimeOfDay((t) => (t === 'day' ? 'night' : 'day'))}
            className="rounded border border-line px-3 py-1 text-muted hover:text-text"
          >
            {timeOfDay === 'day' ? 'Day (click for night)' : 'Night (click for day)'}
          </button>
          {impact && (
            <button type="button" onClick={() => setImpact(null)} className="rounded border border-line px-3 py-1 text-muted hover:text-text">
              Clear
            </button>
          )}
          {impactNode && (
            <button type="button" onClick={runImpact} className="rounded border border-warning/60 px-3 py-1 text-warning hover:bg-warning/10">
              What if this fails?
            </button>
          )}
        </div>
      </div>

      <div className="flex h-[520px] gap-4">
        <div className="min-w-0 flex-1">
          <Campus3D
            campus={campus}
            selection={selection}
            onSelect={select}
            buildingDetail={buildingDetail}
            roomDetail={roomDetail}
            connections={connections}
            highlightIds={impact?.affected?.ids ?? []}
            timeOfDay={timeOfDay}
          />
        </div>
        <aside className="w-96 shrink-0 overflow-auto">
          <DrillDownPanel
            campus={campus}
            alerts={alerts}
            selection={selection}
            onSelect={select}
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
