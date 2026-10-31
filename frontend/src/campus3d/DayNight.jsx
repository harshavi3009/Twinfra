import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Sky, fog and lights for day and night. The change is eased over about a second.
const DAY = { bg: '#050810', ambient: 0.55, hemi: 0.5, sun: 0.9 }
const NIGHT = { bg: '#010207', ambient: 0.12, hemi: 0.1, sun: 0.1 }

const DAY_BG = new THREE.Color(DAY.bg)
const NIGHT_BG = new THREE.Color(NIGHT.bg)

// night = false (day) or true (night). Each frame the look moves a fraction of the way to the target.
export default function DayNight({ night = false }) {
  const bgRef = useRef()
  const fogRef = useRef()
  const ambientRef = useRef()
  const hemiRef = useRef()
  const sunRef = useRef()
  const amount = useRef(0) // 0 = day, 1 = night

  useFrame((_, dt) => {
    amount.current += ((night ? 1 : 0) - amount.current) * (1 - Math.exp(-dt * 2.5))
    const t = amount.current
    const mix = (a, b) => a + (b - a) * t

    bgRef.current.lerpColors(DAY_BG, NIGHT_BG, t)
    fogRef.current.color.lerpColors(DAY_BG, NIGHT_BG, t)
    ambientRef.current.intensity = mix(DAY.ambient, NIGHT.ambient)
    hemiRef.current.intensity = mix(DAY.hemi, NIGHT.hemi)
    sunRef.current.intensity = mix(DAY.sun, NIGHT.sun)
  })

  return (
    <>
      <color attach="background" ref={bgRef} args={[DAY.bg]} />
      <fog attach="fog" ref={fogRef} args={[DAY.bg, 140, 330]} />

      <ambientLight ref={ambientRef} intensity={DAY.ambient} color="#8aa4ff" />
      <hemisphereLight ref={hemiRef} args={['#9db8ff', '#0b1020', DAY.hemi]} />
      <directionalLight ref={sunRef} position={[70, 120, 50]} intensity={DAY.sun} color="#cfe0ff" />
    </>
  )
}
