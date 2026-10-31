import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mulberry32 } from './constants'
import { HUB, buildPaths, distToSegment } from './layout'

const TREE_COUNT = 46
const FIELD_RADIUS = 85

const foliageGeo = new THREE.ConeGeometry(1.6, 4.2, 6)
const trunkGeo = new THREE.CylinderGeometry(0.25, 0.32, 1.4, 5)

// Low-poly trees (two instanced meshes). Placed with a seeded PRNG, kept clear of
// buildings, utility nodes and paths.
export default function Trees({ buildings, utilities = [] }) {
  const foliageRef = useRef()
  const trunkRef = useRef()

  const trees = useMemo(() => {
    const rand = mulberry32(2026)
    const paths = buildPaths(buildings)
    const out = []
    let guard = 0
    while (out.length < TREE_COUNT && guard++ < 2000) {
      const angle = rand() * Math.PI * 2
      const r = 20 + Math.sqrt(rand()) * (FIELD_RADIUS - 20)
      const x = Math.cos(angle) * r
      const z = Math.sin(angle) * r

      const insideBuilding = buildings.some((b) => {
        const m = 6
        return (
          Math.abs(x - b.position.x) < b.size.w / 2 + m && Math.abs(z - b.position.z) < b.size.d / 2 + m
        )
      })
      const nearUtility = utilities.some(
        (u) => Math.hypot(x - u.position.x, z - u.position.z) < 9
      )
      const nearPath = paths.some((s) => distToSegment(x, z, s) < 3.5)
      const nearHub = Math.hypot(x - HUB.x, z - HUB.z) < 8
      if (insideBuilding || nearUtility || nearPath || nearHub) continue

      out.push({ x, z, s: 0.8 + rand() * 0.7, ry: rand() * Math.PI })
    }
    return out
  }, [buildings, utilities])

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D()
    trees.forEach((t, i) => {
      dummy.position.set(t.x, 0.7 * t.s, t.z)
      dummy.scale.setScalar(t.s)
      dummy.rotation.set(0, t.ry, 0)
      dummy.updateMatrix()
      trunkRef.current.setMatrixAt(i, dummy.matrix)

      dummy.position.set(t.x, (1.4 + 2.1) * t.s, t.z)
      dummy.updateMatrix()
      foliageRef.current.setMatrixAt(i, dummy.matrix)
    })
    trunkRef.current.instanceMatrix.needsUpdate = true
    foliageRef.current.instanceMatrix.needsUpdate = true
  }, [trees])

  return (
    <group>
      <instancedMesh ref={trunkRef} args={[trunkGeo, undefined, trees.length]}>
        <meshStandardMaterial color="#2a1f1a" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={foliageRef} args={[foliageGeo, undefined, trees.length]}>
        <meshStandardMaterial color="#0f4a35" emissive="#06281c" flatShading roughness={0.9} />
      </instancedMesh>
    </group>
  )
}
