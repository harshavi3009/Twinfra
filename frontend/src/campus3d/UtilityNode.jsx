import { useMemo } from 'react'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { PALETTE } from './constants'

const bodyMat = new THREE.MeshStandardMaterial({ color: '#0e1830', roughness: 0.5, metalness: 0.5 })

function edgeMaterial(color) {
  return new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), toneMapped: false })
}
const electricEdge = edgeMaterial(PALETTE.electric)
const waterEdge = edgeMaterial(PALETTE.water)

const tagStyle = {
  padding: '2px 8px',
  borderRadius: 6,
  background: 'rgba(5, 10, 20, 0.72)',
  border: '1px solid rgba(120, 180, 255, 0.25)',
  color: '#e6f0ff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  whiteSpace: 'nowrap',
  userSelect: 'none',
  pointerEvents: 'none',
}

// Lightning-bolt outline used on the substation.
function useBoltShape() {
  return useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(0.35, 1)
    s.lineTo(-0.45, -0.1)
    s.lineTo(-0.02, -0.1)
    s.lineTo(-0.3, -1)
    s.lineTo(0.5, 0.15)
    s.lineTo(0.08, 0.15)
    s.closePath()
    return s
  }, [])
}

function Substation() {
  const bolt = useBoltShape()
  const boxGeo = useMemo(() => new THREE.BoxGeometry(5, 3.4, 5), [])
  const edges = useMemo(() => new THREE.EdgesGeometry(boxGeo), [boxGeo])
  return (
    <group>
      <mesh geometry={boxGeo} material={bodyMat} position-y={1.7} />
      <lineSegments geometry={edges} material={electricEdge} position-y={1.7} />
      <mesh position={[0, 1.8, 2.52]} scale={1.1}>
        <shapeGeometry args={[bolt]} />
        <meshBasicMaterial color={PALETTE.electric} toneMapped={false} />
      </mesh>
      <mesh position={[0, 1.8, -2.52]} rotation-y={Math.PI} scale={1.1}>
        <shapeGeometry args={[bolt]} />
        <meshBasicMaterial color={PALETTE.electric} toneMapped={false} />
      </mesh>
      {/* small transformer cans on the roof */}
      {[-1.3, 0, 1.3].map((x) => (
        <mesh key={x} position={[x, 3.9, 0]} material={bodyMat}>
          <cylinderGeometry args={[0.45, 0.45, 1, 10]} />
        </mesh>
      ))}
    </group>
  )
}

function WaterTank() {
  const tankGeo = useMemo(() => new THREE.CylinderGeometry(2.6, 2.6, 4, 24), [])
  const edges = useMemo(() => new THREE.EdgesGeometry(tankGeo, 20), [tankGeo])
  return (
    <group>
      {[
        [-1.8, -1.8],
        [1.8, -1.8],
        [-1.8, 1.8],
        [1.8, 1.8],
      ].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 1.5, z]} material={bodyMat}>
          <boxGeometry args={[0.35, 3, 0.35]} />
        </mesh>
      ))}
      <mesh geometry={tankGeo} material={bodyMat} position-y={5} />
      <lineSegments geometry={edges} material={waterEdge} position-y={5} />
      <mesh position-y={7.5} material={bodyMat}>
        <coneGeometry args={[2.7, 1.2, 24]} />
      </mesh>
      <mesh position-y={5} rotation-x={Math.PI / 2}>
        <torusGeometry args={[2.62, 0.06, 8, 40]} />
        <meshBasicMaterial color={PALETTE.water} toneMapped={false} />
      </mesh>
    </group>
  )
}

// Substation (electricity) or water tank, chosen by the `type` from /api/campus utilities.
export default function UtilityNode({ data }) {
  const { type, position } = data
  const isWater = /tank|water/i.test(type ?? '')
  const label = isWater ? 'Water tank' : 'Substation'
  return (
    <group position={[position.x, 0, position.z]}>
      {isWater ? <WaterTank /> : <Substation />}
      <Html position={[0, isWater ? 10 : 6.5, 0]} center distanceFactor={110} zIndexRange={[20, 0]}>
        <div style={tagStyle}>{isWater ? '💧' : '⚡'} {label}</div>
      </Html>
    </group>
  )
}
