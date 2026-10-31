import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { PALETTE } from './constants'

const PIPE_Y = 0.8 // lines run just above the ground
const IMPACT_COLOR = '#ef4444'
const UTILITY_COLOR = { electricity: PALETTE.electric, water: PALETTE.water }

// One dashed line whose dashes slide along it. Faster and thicker for a building with more load.
function FlowLine({ from, to, load, color, impact }) {
  const ref = useRef()
  const points = useMemo(() => [from, to], [from, to])
  useFrame((_, dt) => {
    if (ref.current) ref.current.material.dashOffset -= dt * (impact ? 4 : 1 + load * 2)
  })
  return (
    <Line
      ref={ref}
      points={points}
      color={impact ? IMPACT_COLOR : color}
      lineWidth={1 + load * 2}
      dashed
      dashSize={1.2}
      gapSize={0.8}
      transparent
      opacity={0.9}
    />
  )
}

// Utility lines for one utility ('electricity' or 'water'), from its node to each building it feeds.
// Only drawn while that utility is picked in Campus3D. Lines into affected buildings turn red.
export default function FlowLines({ connections, buildings, utilities, utility, highlightIds }) {
  const lines = useMemo(() => {
    if (!utility || !connections) return []
    const nodes = new Map([...utilities, ...buildings].map((n) => [n.id, n]))
    const byId = new Map(buildings.map((b) => [b.id, b]))
    return connections.edges
      .filter((e) => e.utility === utility && nodes.has(e.from) && byId.has(e.to))
      .map((e) => {
        const src = nodes.get(e.from)
        const dst = byId.get(e.to)
        return {
          key: `${e.from}>${e.to}`,
          from: [src.position.x, PIPE_Y, src.position.z],
          to: [dst.position.x, PIPE_Y, dst.position.z],
          load: Math.min(1, (dst.power_kw ?? 0) / 200),
          building: e.to,
        }
      })
  }, [connections, buildings, utilities, utility])

  // Ids look like B1-F1-R01, so the building is the part before the first dash.
  const affected = useMemo(() => new Set(highlightIds.map((id) => id.split('-')[0])), [highlightIds])

  return lines.map((l) => (
    <FlowLine
      key={l.key}
      from={l.from}
      to={l.to}
      load={l.load}
      color={UTILITY_COLOR[utility]}
      impact={affected.has(l.building)}
    />
  ))
}
