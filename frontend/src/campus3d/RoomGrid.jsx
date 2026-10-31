import { useEffect, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { SLAB_THICKNESS } from './constants'
import { roomCells } from './layout'
import EquipmentMarkers from './EquipmentMarkers'

// Heatmap on power_kw / baseline_kw: cool blue -> cyan -> yellow -> hot red.
const HEAT_STOPS = [
  [0.6, new THREE.Color('#2b6cff')],
  [0.95, new THREE.Color('#22d3ee')],
  [1.15, new THREE.Color('#facc15')],
  [1.7, new THREE.Color('#ef4444')],
]

function heatColor(ratio, out = new THREE.Color()) {
  const r = Math.min(Math.max(ratio, HEAT_STOPS[0][0]), HEAT_STOPS.at(-1)[0])
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [hi, hiColor] = HEAT_STOPS[i]
    const [lo, loColor] = HEAT_STOPS[i - 1]
    if (r <= hi) return out.copy(loColor).lerp(hiColor, (r - lo) / (hi - lo))
  }
  return out.copy(HEAT_STOPS.at(-1)[1])
}

const TILE_H = 0.6

function applyRoomLook(mat, color, intensity) {
  mat.color.copy(color)
  mat.emissive.copy(color)
  mat.emissiveIntensity = intensity
}

function Room({ room, cell, selected, anySelected, onSelect, equipment, selectedEquipmentId, onPickEquipment }) {
  const [hover, setHover] = useState(false)
  const ratio = room.baseline_kw > 0 ? room.power_kw / room.baseline_kw : 1
  const color = useMemo(() => heatColor(ratio), [ratio])
  const critical = room.status === 'critical'

  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.9, roughness: 0.4, toneMapped: false }),
    []
  )
  useEffect(() => () => mat.dispose(), [mat])

  const outline = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(cell.w + 0.1, TILE_H + 0.1, cell.d + 0.1)),
    [cell.w, cell.d]
  )
  useEffect(() => () => outline.dispose(), [outline])

  useFrame(({ clock }) => {
    const pulse = critical ? 0.5 + 0.5 * Math.sin(clock.elapsedTime * 4.5) : 0
    const base = selected ? 1.1 : anySelected ? 0.45 : 0.7
    applyRoomLook(mat, color, base + pulse * 0.9 + (hover ? 0.5 : 0))
  })

  return (
    <group position={[cell.x, SLAB_THICKNESS + TILE_H / 2, cell.z]}>
      <mesh
        material={mat}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHover(true)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          setHover(false)
          document.body.style.cursor = ''
        }}
        onClick={(e) => {
          if (e.delta > 6) return
          e.stopPropagation()
          onSelect(room.id)
        }}
      >
        <boxGeometry args={[cell.w, TILE_H, cell.d]} />
      </mesh>
      {selected && (
        <lineSegments geometry={outline} position-y={0.01}>
          <lineBasicMaterial color="#ffffff" toneMapped={false} />
        </lineSegments>
      )}
      {(hover || selected) && (
        <Html center position={[0, 1.2, 0]} distanceFactor={70} style={{ pointerEvents: 'none' }}>
          <div
            style={{
              padding: '3px 9px',
              borderRadius: 6,
              background: 'rgba(5,10,20,0.85)',
              border: '1px solid rgba(160,200,255,0.35)',
              color: '#e6f0ff',
              fontFamily: 'system-ui, sans-serif',
              fontSize: 12,
              whiteSpace: 'nowrap',
            }}
          >
            {room.name} · {room.power_kw} / {room.baseline_kw} kW
          </div>
        </Html>
      )}
      {selected && (
        <group position-y={0.4}>
          <EquipmentMarkers
            room={room}
            width={cell.w}
            equipment={equipment}
            selectedId={selectedEquipmentId}
            onPick={onPickEquipment}
          />
        </group>
      )}
    </group>
  )
}

// Rooms of one floor as a heatmap grid on its slab. Lives inside the Floor group so it moves with it.
export default function RoomGrid({ floor, size, selectedRoomId, anyRoomSelected, onSelectRoom, roomDetail, selectedEquipmentId, onPickEquipment }) {
  const cells = useMemo(() => roomCells(floor.rooms.length, size), [floor.rooms.length, size])
  return (
    <group>
      {floor.rooms.map((room, i) => (
        <Room
          key={room.id}
          room={room}
          cell={cells[i]}
          selected={room.id === selectedRoomId}
          anySelected={anyRoomSelected}
          onSelect={onSelectRoom}
          equipment={roomDetail?.id === room.id ? roomDetail.equipment : null}
          selectedEquipmentId={selectedEquipmentId}
          onPickEquipment={onPickEquipment}
        />
      ))}
    </group>
  )
}
