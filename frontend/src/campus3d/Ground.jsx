import { useMemo } from 'react'
import { Grid } from '@react-three/drei'
import { PALETTE } from './constants'
import { HUB, buildPaths } from './layout'

const PATH_WIDTH = 2.4

// Dark ground disc, faint grid, glowing paths between buildings and a central plaza.
export default function Ground({ buildings }) {
  const paths = useMemo(() => buildPaths(buildings), [buildings])

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.02}>
        <circleGeometry args={[150, 64]} />
        <meshStandardMaterial color={PALETTE.ground} roughness={1} metalness={0} />
      </mesh>

      <Grid
        position-y={0.01}
        args={[300, 300]}
        cellSize={5}
        cellThickness={0.6}
        cellColor={PALETTE.grid}
        sectionSize={25}
        sectionThickness={1}
        sectionColor={PALETTE.gridSection}
        fadeDistance={170}
        fadeStrength={2}
      />

      {paths.map((s, i) => {
        const horizontal = s.z1 === s.z2
        const length = Math.abs(horizontal ? s.x2 - s.x1 : s.z2 - s.z1) + PATH_WIDTH
        return (
          <mesh
            key={i}
            rotation-x={-Math.PI / 2}
            position={[(s.x1 + s.x2) / 2, 0.03, (s.z1 + s.z2) / 2]}
          >
            <planeGeometry args={horizontal ? [length, PATH_WIDTH] : [PATH_WIDTH, length]} />
            <meshBasicMaterial color={PALETTE.path} toneMapped={false} transparent opacity={0.7} />
          </mesh>
        )
      })}

      <mesh rotation-x={-Math.PI / 2} position={[HUB.x, 0.04, HUB.z]}>
        <ringGeometry args={[3.2, 4.4, 48]} />
        <meshBasicMaterial color="#22d3ee" toneMapped={false} transparent opacity={0.55} />
      </mesh>
    </group>
  )
}
