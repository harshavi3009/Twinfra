import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { FLOOR_HEIGHT, PALETTE, SLAB_THICKNESS, floorY, statusColor } from './constants'
import Floor from './Floor'
import AlertBeacon from './AlertBeacon'
import { useDelayedReady } from './useDelayedReady'
import RoomGrid from './RoomGrid'

// Soft radial glow texture, built once and shared by every building's ground halo.
let glowTexture
function getGlowTexture() {
  if (!glowTexture) {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')
    const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64)
    grad.addColorStop(0, 'rgba(255,255,255,0.9)')
    grad.addColorStop(0.6, 'rgba(255,255,255,0.25)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 128, 128)
    glowTexture = new THREE.CanvasTexture(c)
    glowTexture.colorSpace = THREE.SRGBColorSpace
  }
  return glowTexture
}

// Opacity targets per state. normal = campus view, dim = another building is selected (~20%),
// open = this building is selected (walls nearly clear so the rooms inside show).
const LOOKS = {
  normal: { body: 0.55, slab: 1, win: 1, edge: 1, glow: 0.4 },
  dim: { body: 0.11, slab: 0.2, win: 0.2, edge: 0.2, glow: 0.08 },
  open: { body: 0.07, slab: 0.5, win: 0.18, edge: 0.45, glow: 0.25 },
}

// Per-frame material update (plain function: mutating three.js materials is expected here).
function applyLook(mats, color, pulse, look, hover) {
  mats.body.emissive.copy(color)
  mats.body.emissiveIntensity = 0.12 + pulse * 0.45 + hover * 0.35
  mats.body.opacity = look.body + hover * 0.12
  mats.slab.opacity = look.slab
  mats.window.opacity = look.win
  mats.edge.color.copy(color).multiplyScalar(1.6 + pulse * 0.8 + hover * 0.9)
  mats.edge.opacity = look.edge
  mats.glow.color.copy(color)
  mats.glow.opacity = look.glow * (1 + pulse) * (1 + hover * 0.5)
}

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  padding: '4px 10px',
  borderRadius: 8,
  background: 'rgba(5, 10, 20, 0.72)',
  border: '1px solid rgba(120, 180, 255, 0.25)',
  backdropFilter: 'blur(4px)',
  color: '#e6f0ff',
  fontFamily: 'system-ui, sans-serif',
  whiteSpace: 'nowrap',
  userSelect: 'none',
  pointerEvents: 'none',
  position: 'relative',
  transition: 'opacity 0.35s',
}

/**
 * A building: stacked floors, status colour, hover highlight, fades when another building is
 * selected, and when selected the floors explode apart and show a room heatmap.
 */
export default function Building({
  data,
  selected = false,
  dimmed = false,
  detail = null, // GET /api/buildings/{id} for this building (only when selected)
  selection,
  roomDetail = null,
  onSelect,
  labelDelay = 0, // ms before this building's label mounts (see index.jsx)
}) {
  const { id, name, floors, position, size, status, power_kw, active_alerts } = data
  const { w, d } = size
  const count = Math.max(1, floors)

  // Materials are created once per building; colour/opacity are animated in useFrame.
  const mats = useMemo(
    () => ({
      body: new THREE.MeshStandardMaterial({
        color: PALETTE.body,
        transparent: true,
        opacity: 0.55,
        roughness: 0.35,
        metalness: 0.2,
        emissive: new THREE.Color(statusColor('offline')),
        emissiveIntensity: 0.12,
        depthWrite: false,
      }),
      slab: new THREE.MeshStandardMaterial({
        color: PALETTE.slab,
        roughness: 0.6,
        metalness: 0.3,
        transparent: true,
      }),
      window: new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false }),
      edge: new THREE.LineBasicMaterial({ color: statusColor('offline'), toneMapped: false, transparent: true }),
      glow: new THREE.MeshBasicMaterial({
        map: getGlowTexture(),
        color: statusColor('offline'),
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    }),
    []
  )

  // Geometry is shared by all floors of this building.
  const geos = useMemo(() => {
    const body = new THREE.BoxGeometry(w - 0.4, FLOOR_HEIGHT - SLAB_THICKNESS, d - 0.4)
    return {
      body,
      edges: new THREE.EdgesGeometry(body),
      slab: new THREE.BoxGeometry(w, SLAB_THICKNESS, d),
    }
  }, [w, d])

  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose())
    },
    [mats]
  )
  useEffect(
    () => () => {
      Object.values(geos).forEach((g) => g.dispose())
    },
    [geos]
  )

  // Animated state lives in refs so it never triggers React re-renders.
  const target = useMemo(() => new THREE.Color(statusColor(status)), [status])
  const current = useRef(null)
  if (current.current === null) current.current = new THREE.Color(statusColor(status))
  const look = useRef({ ...LOOKS.normal })
  const hoverRef = useRef(0) // 0..1 eased
  const hoverWanted = useRef(false)
  const explode = useRef(0) // 0 stacked .. 1 exploded
  const floorRefs = useRef([])
  const labelRef = useRef()
  const critical = status === 'critical'
  const lookTarget = selected ? LOOKS.open : dimmed ? LOOKS.dim : LOOKS.normal

  useFrame(({ clock }, dt) => {
    const k = 1 - Math.exp(-dt * 6)
    current.current.lerp(target, k)

    // ease opacity levels toward the current target look
    const l = look.current
    for (const key of Object.keys(l)) l[key] += (lookTarget[key] - l[key]) * k
    hoverRef.current += ((hoverWanted.current && !selected ? 1 : 0) - hoverRef.current) * k

    const pulse = critical ? 0.5 + 0.5 * Math.sin(clock.elapsedTime * 4) : 0
    applyLook(mats, current.current, pulse, l, hoverRef.current)

    // explode / collapse floors
    explode.current += ((selected ? 1 : 0) - explode.current) * (1 - Math.exp(-dt * 3.5))
    floorRefs.current.forEach((g, i) => {
      if (g) g.position.y = floorY(i + 1, explode.current)
    })
    if (labelRef.current) {
      labelRef.current.position.y = floorY(count, explode.current) + FLOOR_HEIGHT + SLAB_THICKNESS + 3
    }
  })

  // Reset the cursor if this building is removed/deselected while hovered.
  useEffect(() => {
    if (selected) {
      hoverWanted.current = false
      document.body.style.cursor = ''
    }
  }, [selected])

  const [labelHover, setLabelHover] = useState(false)

  // Mount labels one after another: React drops a label that mounts at the same moment as another.
  const labelReady = useDelayedReady(labelDelay)
  const dotColor = statusColor(status)

  const selectRoom = (floorId) => (roomId) => onSelect({ buildingId: id, floorId, roomId })
  const pickEquipment = (equipmentId) =>
    onSelect({ buildingId: id, floorId: selection.floorId, roomId: selection.roomId, equipmentId })

  return (
    <group
      position={[position.x, 0, position.z]}
      onPointerOver={(e) => {
        if (selected) return
        e.stopPropagation()
        hoverWanted.current = true
        setLabelHover(true)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        hoverWanted.current = false
        setLabelHover(false)
        document.body.style.cursor = ''
      }}
      onClick={(e) => {
        if (selected || e.delta > 6) return
        e.stopPropagation()
        onSelect({ buildingId: id })
      }}
    >
      <mesh rotation-x={-Math.PI / 2} position-y={0.06} material={mats.glow} raycast={() => null}>
        <planeGeometry args={[w * 1.7, d * 1.9]} />
      </mesh>

      {Array.from({ length: count }, (_, i) => {
        const level = i + 1
        const floorDetail = selected ? detail?.floors?.find((f) => f.level === level) : null
        return (
          <Floor
            key={level}
            ref={(el) => {
              floorRefs.current[i] = el
            }}
            buildingId={id}
            level={level}
            size={size}
            isTop={level === count}
            geos={geos}
            mats={mats}
            solid={!selected}
          >
            {floorDetail && (
              <RoomGrid
                floor={floorDetail}
                size={size}
                selectedRoomId={selection.roomId}
                anyRoomSelected={Boolean(selection.roomId)}
                onSelectRoom={selectRoom(floorDetail.id)}
                roomDetail={roomDetail}
                selectedEquipmentId={selection.equipmentId}
                onPickEquipment={pickEquipment}
              />
            )}
          </Floor>
        )
      })}

      <group ref={labelRef}>
        {active_alerts > 0 && <AlertBeacon y={5.5} />}
        {labelReady && (
        <Html center distanceFactor={110} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div
            style={{
              ...labelStyle,
              opacity: dimmed ? 0.2 : 1,
              border: `1px solid ${labelHover ? dotColor : 'rgba(120, 180, 255, 0.25)'}`,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600 }}>{name}</div>
            <div style={{ fontSize: 13, color: '#9db4d6' }}>
              <span style={{ color: dotColor }}>●</span> {Number(power_kw ?? 0).toFixed(1)} kW
            </div>
            {active_alerts > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: -9,
                  right: -9,
                  minWidth: 20,
                  height: 20,
                  padding: '0 5px',
                  borderRadius: 10,
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                  lineHeight: '20px',
                  textAlign: 'center',
                  boxShadow: '0 0 10px rgba(239,68,68,0.8)',
                }}
              >
                {active_alerts}
              </div>
            )}
          </div>
        </Html>
        )}
      </group>
    </group>
  )
}
