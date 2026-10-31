import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { statusColor } from './constants'

// Shared geometries: one per shape, reused by every marker.
const GEOS = {
  box: new THREE.BoxGeometry(0.9, 0.9, 0.9),
  sphere: new THREE.SphereGeometry(0.55, 12, 10),
  cylinder: new THREE.CylinderGeometry(0.45, 0.45, 1, 12),
  octa: new THREE.OctahedronGeometry(0.65),
  cone: new THREE.ConeGeometry(0.55, 1.1, 8),
}
const SHAPE_BY_TYPE = {
  ac: 'box',
  computers: 'box',
  server_rack: 'box',
  lift: 'box',
  lighting: 'sphere',
  pump: 'cylinder',
  water_cooler: 'cylinder',
  transformer: 'octa',
  lathe: 'cone',
}

const GENERIC_COLOR = '#7aa2d6'

function bob(group, t, phase, base, scale) {
  group.position.y = base + Math.sin(t * 2 + phase) * 0.18
  group.scale.setScalar(scale)
}

function Marker({ x, y, index, item, selected, onPick }) {
  const group = useRef()
  const [hover, setHover] = useState(false)
  const clickable = Boolean(item?.id)
  const shape = GEOS[SHAPE_BY_TYPE[item?.eq_type] ?? 'octa']
  const color = item ? statusColor(item.health ?? 'ok') : GENERIC_COLOR

  useFrame(({ clock }) => {
    bob(group.current, clock.elapsedTime, index, y, selected || hover ? 1.35 : 1)
  })

  return (
    <group
      ref={group}
      position={[x, y, 0]}
      onPointerOver={(e) => {
        if (!clickable) return
        e.stopPropagation()
        setHover(true)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        setHover(false)
        document.body.style.cursor = ''
      }}
      onClick={(e) => {
        if (e.delta > 6 || !clickable) return
        e.stopPropagation()
        onPick(item.id)
      }}
    >
      <mesh geometry={shape}>
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected || hover ? 1.4 : 0.8}
          toneMapped={false}
          transparent={!clickable}
          opacity={clickable ? 1 : 0.75}
        />
      </mesh>
      {selected && (
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.95, 0.05, 8, 28]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
      )}
      {(hover || selected) && item && (
        <Html center position={[0, 1.4, 0]} distanceFactor={60} style={{ pointerEvents: 'none' }}>
          <div
            style={{
              padding: '2px 8px',
              borderRadius: 6,
              background: 'rgba(5,10,20,0.85)',
              border: `1px solid ${color}`,
              color: '#e6f0ff',
              fontFamily: 'system-ui, sans-serif',
              fontSize: 12,
              whiteSpace: 'nowrap',
            }}
          >
            {item.name} · {Number(item.power_kw ?? 0).toFixed(1)} kW
          </div>
        </Html>
      )}
    </group>
  )
}

// Markers hover above the selected room. With the room's equipment list (`roomDetail`) they are
// typed + clickable; without it we draw `equipment_count` generic, non-clickable markers.
export default function EquipmentMarkers({ room, width, equipment, selectedId, onPick }) {
  const items = equipment?.length ? equipment : null
  const count = items ? items.length : Math.min(room.equipment_count ?? 0, 12)
  if (!count) return null

  const step = Math.min(1.9, (width - 1) / Math.max(1, count))
  return (
    <group>
      {Array.from({ length: count }, (_, i) => (
        <Marker
          key={items ? items[i].id : i}
          index={i}
          x={(i - (count - 1) / 2) * step}
          y={2.4}
          item={items ? items[i] : null}
          selected={Boolean(items) && items[i].id === selectedId}
          onPick={onPick}
        />
      ))}
    </group>
  )
}
