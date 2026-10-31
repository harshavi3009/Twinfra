import { useEffect, useState } from 'react'
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts'
import { getReadings } from '../api/client.js'

// Small last-6-hours chart of the entity behind a ticket, so the technician sees the fault trend.
export default function EvidenceSparkline({ entityId, metric = 'power_kw' }) {
  const [points, setPoints] = useState(null)

  useEffect(() => {
    let alive = true
    getReadings(entityId, metric, 6)
      .then((r) => alive && setPoints(r.points.map((p) => ({ value: p.value, baseline: p.baseline }))))
      .catch(() => alive && setPoints([]))
    return () => {
      alive = false
    }
  }, [entityId, metric])

  if (!points || points.length === 0) return null

  return (
    <div className="mt-2 h-20 rounded-md border border-line bg-panel-2 p-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points}>
          <YAxis hide domain={['auto', 'auto']} />
          <Tooltip contentStyle={{ background: '#111a2e', border: '1px solid #22304d', fontSize: 12 }} />
          <Line type="monotone" dataKey="baseline" stroke="#8ea0bd" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="value" stroke="#f59e0b" dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
