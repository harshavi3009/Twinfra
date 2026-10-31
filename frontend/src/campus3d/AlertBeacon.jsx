import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Shared across all beacons: one geometry, one material (colour never changes).
const GEO = new THREE.OctahedronGeometry(0.9)
const MAT = new THREE.MeshBasicMaterial({ color: '#ef4444', toneMapped: false })

// Floating, bobbing marker above a building that has active alerts.
// Lives inside the building's label group, so it moves with the label on explode.
export default function AlertBeacon({ y }) {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (!ref.current) return
    ref.current.position.y = y + Math.sin(clock.elapsedTime * 2.2) * 0.35
    ref.current.rotation.y = clock.elapsedTime * 1.4
  })
  return <mesh ref={ref} geometry={GEO} material={MAT} position={[0, y, 0]} raycast={() => null} />
}
