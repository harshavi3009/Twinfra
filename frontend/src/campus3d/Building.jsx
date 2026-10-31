import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { FLOOR_HEIGHT, PALETTE, SLAB_THICKNESS, statusColor } from './constants'
import Floor from './Floor'

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
}

// A building: stacked floors, status colour, pulsing glow when critical, floating label.
export default function Building({ data }) {
  const { id, name, floors, position, size, status, power_kw, active_alerts } = data
  const { w, d } = size
  const count = Math.max(1, floors)
  const height = count * FLOOR_HEIGHT

  // Materials are created once per building; the colour is animated in useFrame.
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
      }),
      slab: new THREE.MeshStandardMaterial({ color: PALETTE.slab, roughness: 0.6, metalness: 0.3 }),
      edge: new THREE.LineBasicMaterial({ color: statusColor('offline'), toneMapped: false }),
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

  // Smooth status transitions (lerp, no flicker) + critical pulse.
  const target = useMemo(() => new THREE.Color(statusColor(status)), [status])
  const current = useRef(null)
  if (current.current === null) current.current = new THREE.Color(statusColor(status))
  const critical = status === 'critical'

  useFrame(({ clock }, dt) => {
    const cur = current.current
    cur.lerp(target, 1 - Math.exp(-dt * 6))
    const pulse = critical ? 0.5 + 0.5 * Math.sin(clock.elapsedTime * 4) : 0

    mats.body.emissive.copy(cur)
    mats.body.emissiveIntensity = 0.12 + pulse * 0.45
    mats.edge.color.copy(cur).multiplyScalar(1.6 + pulse * 0.8)
    mats.glow.color.copy(cur)
    mats.glow.opacity = 0.4 + pulse * 0.4
  })

  const dotColor = statusColor(status)

  return (
    <group position={[position.x, 0, position.z]}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.06} material={mats.glow}>
        <planeGeometry args={[w * 1.7, d * 1.9]} />
      </mesh>

      {Array.from({ length: count }, (_, i) => (
        <Floor
          key={i}
          buildingId={id}
          level={i + 1}
          size={size}
          isTop={i === count - 1}
          geos={geos}
          mats={mats}
        />
      ))}

      <Html
        position={[0, height + SLAB_THICKNESS + 3, 0]}
        center
        distanceFactor={110}
        zIndexRange={[20, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div style={labelStyle}>
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
    </group>
  )
}
