import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { PALETTE } from './constants'

// Sky, fog, lights and surfaces for day and night. Everything eases over about a second.
const DAY = { bg: '#dfeaf6', ambient: 1.4, hemi: 1.6, sun: 2.2, ground: '#b8c7b0', body: '#7d95b5', slab: '#c9d6e6' }
const NIGHT = { bg: '#000104', ambient: 0.04, hemi: 0.03, sun: 0.03, ground: PALETTE.ground, body: PALETTE.body, slab: PALETTE.slab }

const colorOf = (hex) => new THREE.Color(hex)
const DAY_BG = colorOf(DAY.bg)
const NIGHT_BG = colorOf(NIGHT.bg)
const DAY_GROUND = colorOf(DAY.ground)
const NIGHT_GROUND = colorOf(NIGHT.ground)
const DAY_BODY = colorOf(DAY.body)
const NIGHT_BODY = colorOf(NIGHT.body)
const DAY_SLAB = colorOf(DAY.slab)
const NIGHT_SLAB = colorOf(NIGHT.slab)

// Returns a ref holding 0 (day) .. 1 (night), eased toward `night` every frame.
export function useNightAmount(night) {
  const amount = useRef(0)
  useFrame((_, dt) => {
    amount.current += ((night ? 1 : 0) - amount.current) * (1 - Math.exp(-dt * 2.5))
  })
  return amount
}

// Colours for the parts that change between day and night (used by Ground and Building).
export const dayNightColors = {
  ground: { day: DAY_GROUND, night: NIGHT_GROUND },
  body: { day: DAY_BODY, night: NIGHT_BODY },
  slab: { day: DAY_SLAB, night: NIGHT_SLAB },
}

// night = false (day) or true (night).
export default function DayNight({ night = false }) {
  const bgRef = useRef()
  const fogRef = useRef()
  const ambientRef = useRef()
  const hemiRef = useRef()
  const sunRef = useRef()
  const amount = useNightAmount(night)

  useFrame(() => {
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

      <ambientLight ref={ambientRef} intensity={DAY.ambient} color="#ffffff" />
      <hemisphereLight ref={hemiRef} args={['#ffffff', '#8aa0b8', DAY.hemi]} />
      <directionalLight ref={sunRef} position={[70, 120, 50]} intensity={DAY.sun} color="#fff6e6" />
    </>
  )
}
