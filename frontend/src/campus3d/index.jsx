import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { PALETTE } from './constants'
import Ground from './Ground'
import Trees from './Trees'
import Building from './Building'
import UtilityNode from './UtilityNode'
import Effects from './Effects'

const EMPTY = []

/**
 * <Campus3D /> — props follow docs/contract/api.md ("Frontend ↔ 3D component").
 * R1 renders `campus` only; the other props are accepted and wired up in R2/R3.
 */
export function Campus3D({
  campus,
  // eslint-disable-next-line no-unused-vars
  buildingDetail = null,
  // eslint-disable-next-line no-unused-vars
  selection = null,
  // eslint-disable-next-line no-unused-vars
  onSelect = () => {},
  // eslint-disable-next-line no-unused-vars
  connections = null,
  // eslint-disable-next-line no-unused-vars
  highlightIds = EMPTY,
  // eslint-disable-next-line no-unused-vars
  whatIf = null,
  // eslint-disable-next-line no-unused-vars
  timeOfDay = 'day',
}) {
  const buildings = campus?.buildings ?? EMPTY
  const utilities = campus?.utilities ?? EMPTY

  // Look at the middle of the campus.
  const target = useMemo(() => {
    if (!buildings.length) return [0, 4, 0]
    const x = buildings.reduce((s, b) => s + b.position.x, 0) / buildings.length
    const z = buildings.reduce((s, b) => s + b.position.z, 0) / buildings.length
    return [x, 4, z]
  }, [buildings])

  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [95, 80, 110], fov: 38, near: 0.5, far: 600 }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      style={{ width: '100%', height: '100%', minHeight: 256, background: PALETTE.bg }}
    >
      <color attach="background" args={[PALETTE.bg]} />
      <fog attach="fog" args={[PALETTE.bg, 140, 330]} />

      <ambientLight intensity={0.55} color="#8aa4ff" />
      <hemisphereLight args={['#9db8ff', '#0b1020', 0.5]} />
      <directionalLight position={[70, 120, 50]} intensity={0.9} color="#cfe0ff" />

      <Ground buildings={buildings} />
      <Trees buildings={buildings} utilities={utilities} />
      {buildings.map((b) => (
        <Building key={b.id} data={b} />
      ))}
      {utilities.map((u) => (
        <UtilityNode key={u.id} data={u} />
      ))}

      <OrbitControls
        makeDefault
        target={target}
        enableDamping
        dampingFactor={0.08}
        minDistance={25}
        maxDistance={260}
        maxPolarAngle={Math.PI / 2.15} // can't go under the ground
      />

      <Effects />
    </Canvas>
  )
}

export default Campus3D
