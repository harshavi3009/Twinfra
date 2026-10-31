import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { PALETTE } from './constants'
import Ground from './Ground'
import Trees from './Trees'
import Building from './Building'
import UtilityNode from './UtilityNode'
import FlowLines from './FlowLines'
import Effects from './Effects'
import CameraRig from './CameraRig'
import DayNight from './DayNight'
import { useSelection } from './useSelection'

const EMPTY = []
const DOUBLE_CLICK_MS = 350

// 'water' for the water tank, otherwise 'electricity' (the substation).
const utilityKind = (u) => (/tank|water/i.test(u.type ?? '') ? 'water' : 'electricity')

const simTag = {
  position: 'absolute',
  top: 12,
  right: 12,
  padding: '4px 10px',
  borderRadius: 8,
  border: '1px solid rgba(250,204,21,0.6)',
  background: 'rgba(40,30,5,0.8)',
  color: '#facc15',
  font: '600 12px system-ui, sans-serif',
  letterSpacing: 1,
  pointerEvents: 'none',
}

const backBtn = {
  position: 'absolute',
  top: 12,
  left: 12,
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid rgba(120,180,255,0.35)',
  background: 'rgba(5,10,20,0.75)',
  color: '#e6f0ff',
  font: '13px system-ui, sans-serif',
  cursor: 'pointer',
}

/**
 * <Campus3D /> — props follow docs/contract/api.md ("Frontend ↔ 3D component").
 * Click a building -> floors explode + room heatmap -> click a room -> equipment -> click equipment.
 * `roomDetail` (GET /api/rooms/{id}) is an optional extra prop: it gives the selected room's
 * equipment list so markers are typed and clickable. Without it, generic markers are drawn.
 * `connections` + clicking a utility (substation = electric lines, water tank = pipes) shows its flow lines.
 * `highlightIds` (impact analysis): affected rooms flash, and lines into affected buildings turn red.
 * `whatIf` (per_building from /api/insights/whatif) recolours buildings to their simulated state.
 * `timeOfDay` = 'day' | 'night': night darkens the sky and lights, and makes lit windows glow.
 */
export function Campus3D({
  campus,
  buildingDetail = null,
  selection: selectionProp = null,
  onSelect,
  roomDetail = null,
  connections = null,
  highlightIds = EMPTY,
  whatIf = null,
  timeOfDay = 'day',
}) {
  const buildings = campus?.buildings ?? EMPTY
  const utilities = campus?.utilities ?? EMPTY
  const night = timeOfDay === 'night'
  const { selection, select, back, reset } = useSelection(selectionProp, onSelect)

  // Which utility's lines are showing: 'electricity', 'water', or null. Click the same node again to hide.
  const [flowUtility, setFlowUtility] = useState(null)
  const toggleFlow = (kind) => setFlowUtility((cur) => (cur === kind ? null : kind))

  // whatIf rows keyed by building id, so each Building can look up its simulated state.
  const simById = useMemo(() => new Map((whatIf ?? EMPTY).map((row) => [row.id, row])), [whatIf])

  // Look at the middle of the campus.
  const overviewTarget = useMemo(() => {
    if (!buildings.length) return [0, 4, 0]
    const x = buildings.reduce((s, b) => s + b.position.x, 0) / buildings.length
    const z = buildings.reduce((s, b) => s + b.position.z, 0) / buildings.length
    return [x, 4, z]
  }, [buildings])

  // Esc = zoom out one level.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back])

  // Double-click on empty space = back to the campus view.
  const lastMiss = useRef(0)
  const onPointerMissed = () => {
    const now = performance.now()
    if (now - lastMiss.current < DOUBLE_CLICK_MS) reset()
    lastMiss.current = now
  }

  const anySelected = Boolean(selection.buildingId)
  const selectedBuilding = buildings.find((b) => b.id === selection.buildingId)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 256 }}>
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [95, 80, 110], fov: 38, near: 0.5, far: 600 }}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        style={{ background: PALETTE.bg }}
        onPointerMissed={onPointerMissed}
      >
        <DayNight night={night} />

        <Ground buildings={buildings} night={night} />
        <Trees buildings={buildings} utilities={utilities} />
        {buildings.map((b, i) => {
          const selected = b.id === selection.buildingId
          return (
            <Building
              key={b.id}
              data={b}
              selected={selected}
              dimmed={anySelected && !selected}
              detail={selected && buildingDetail?.id === b.id ? buildingDetail : null}
              selection={selection}
              roomDetail={selected ? roomDetail : null}
              onSelect={select}
              labelDelay={(i + 1) * 150}
              sim={simById.get(b.id) ?? null}
              night={night}
              highlightIds={highlightIds}
            />
          )
        })}
        {utilities.map((u, i) => {
          const kind = utilityKind(u)
          return (
            <UtilityNode
              key={u.id}
              data={u}
              labelDelay={(buildings.length + i + 1) * 150}
              active={flowUtility === kind}
              onPick={() => toggleFlow(kind)}
            />
          )
        })}
        <FlowLines
          connections={connections}
          buildings={buildings}
          utilities={utilities}
          utility={flowUtility}
          highlightIds={highlightIds}
        />

        <CameraRig
          buildings={buildings}
          buildingDetail={buildingDetail}
          selection={selection}
          overviewTarget={overviewTarget}
        />
        <Effects night={night} />
      </Canvas>

      {whatIf && <div style={simTag}>SIMULATED</div>}

      {anySelected && (
        <button type="button" style={backBtn} onClick={back}>
          ← Back{selectedBuilding ? ` · ${selectedBuilding.name}` : ''}
        </button>
      )}
    </div>
  )
}

export default Campus3D
