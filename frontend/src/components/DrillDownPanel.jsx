import { useEffect, useState } from 'react'
import { getBuilding, getEquipment, getRoom } from '../api/client.js'
import AlertCard from './AlertCard.jsx'
import AssetCard from './AssetCard.jsx'

const DOT = { ok: 'bg-ok', warning: 'bg-warning', critical: 'bg-critical', offline: 'bg-offline' }
const EMPTY = { buildingId: null, floorId: null, roomId: null, equipmentId: null }

// Loads one thing from the API whenever `id` changes.
function useFetch(id, fetcher) {
  const [state, setState] = useState({ id: null, data: null })
  useEffect(() => {
    if (!id) return
    let alive = true
    fetcher(id).then((data) => alive && setState({ id, data })).catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  return state.id === id ? state.data : null
}

function PowerBar({ power, baseline }) {
  const pct = Math.min(100, (power / Math.max(baseline * 2, 0.1)) * 100)
  const over = power > baseline * 1.15
  return (
    <div className="h-1.5 w-20 overflow-hidden rounded bg-panel-2">
      <div className={`h-full ${over ? 'bg-critical' : 'bg-ok'}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function Crumb({ children, onClick }) {
  return (
    <button type="button" onClick={onClick} className="text-xs text-accent hover:underline">
      {children}
    </button>
  )
}

export default function DrillDownPanel({ campus, alerts, selection, onSelect, onAlertSelect, onCreateTicket }) {
  const building = useFetch(selection.buildingId, getBuilding)
  const room = useFetch(selection.roomId, getRoom)
  const equipment = useFetch(selection.equipmentId, getEquipment)

  // Equipment level: asset card
  if (selection.equipmentId) {
    return (
      <div className="space-y-2">
        <Crumb onClick={() => onSelect({ ...selection, equipmentId: null })}>← Back to room</Crumb>
        {equipment ? <AssetCard eq={equipment} onCreateTicket={onCreateTicket} /> : <p className="text-muted">Loading…</p>}
      </div>
    )
  }

  // Room level: equipment list
  if (selection.roomId) {
    return (
      <div className="space-y-2">
        <Crumb onClick={() => onSelect({ ...selection, roomId: null })}>← Back to building</Crumb>
        {room ? (
          <>
            <h3 className="text-lg font-semibold">{room.name}</h3>
            <p className="text-xs text-muted">{room.room_type}</p>
            {room.equipment.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onSelect({ ...selection, equipmentId: e.id })}
                className="flex w-full items-center gap-2 rounded-lg border border-line bg-panel p-3 text-left hover:border-accent/50"
              >
                <span className={`h-2.5 w-2.5 rounded-full ${DOT[e.health] || DOT.ok}`} />
                <span className="text-sm font-medium">{e.name}</span>
                <span className="ml-auto font-mono text-xs text-muted">{e.power_kw} kW</span>
              </button>
            ))}
          </>
        ) : (
          <p className="text-muted">Loading…</p>
        )}
      </div>
    )
  }

  // Building level: floors -> rooms
  if (selection.buildingId) {
    return (
      <div className="space-y-2">
        <Crumb onClick={() => onSelect(EMPTY)}>← Campus</Crumb>
        {building ? (
          <>
            <h3 className="text-lg font-semibold">{building.name}</h3>
            {building.floors.map((f) => (
              <div key={f.id}>
                <div className="mb-1 mt-2 text-xs uppercase tracking-wide text-muted">Floor {f.level}</div>
                {f.rooms.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onSelect({ buildingId: building.id, floorId: f.id, roomId: r.id, equipmentId: null })}
                    className="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-line bg-panel p-2.5 text-left hover:border-accent/50"
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${DOT[r.status]}`} />
                    <span className="text-sm">{r.name}</span>
                    <span className="ml-auto flex items-center gap-2 font-mono text-xs text-muted">
                      {r.power_kw} kW <PowerBar power={r.power_kw} baseline={r.baseline_kw} />
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </>
        ) : (
          <p className="text-muted">Loading…</p>
        )}
      </div>
    )
  }

  // Nothing selected: campus summary + top alerts
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Buildings</h3>
      {campus.buildings.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onSelect({ ...EMPTY, buildingId: b.id })}
          className="flex w-full items-center gap-2 rounded-lg border border-line bg-panel p-2.5 text-left hover:border-accent/50"
        >
          <span className={`h-2.5 w-2.5 rounded-full ${DOT[b.status]}`} />
          <span className="text-sm">{b.name}</span>
          <span className="ml-auto flex items-center gap-2 font-mono text-xs text-muted">
            {b.power_kw} kW <PowerBar power={b.power_kw} baseline={b.baseline_kw} />
          </span>
        </button>
      ))}
      <h3 className="pt-2 text-sm font-semibold uppercase tracking-wide text-muted">Top alerts</h3>
      {(alerts || []).slice(0, 3).map((a) => (
        <AlertCard key={a.id} alert={a} onSelect={onAlertSelect} />
      ))}
      {alerts?.length === 0 && <p className="text-sm text-muted">No active alerts.</p>}
    </div>
  )
}
