import { useEffect, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getReadings } from '../api/client.js'

const METRICS = [
  { key: 'power_kw', label: 'Power (kW)', color: '#22d3ee' },
  { key: 'water_lpm', label: 'Water (L/min)', color: '#60a5fa' },
  { key: 'occupancy', label: 'Occupancy', color: '#a78bfa' },
]

function MetricChart({ entityId, metric }) {
  const [res, setRes] = useState(null)

  useEffect(() => {
    let alive = true
    const load = () => getReadings(entityId, metric.key, 24).then((r) => alive && setRes(r)).catch(() => {})
    load()
    const t = setInterval(load, 10000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [entityId, metric.key])

  const points = res?.points.map((p) => ({ ...p, hour: new Date(p.ts).getHours() + ':00' })) || []

  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-muted">{metric.label}</div>
      <div className="h-44">
        {res ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points}>
              <CartesianGrid stroke="#22304d" strokeDasharray="3 3" />
              <XAxis dataKey="hour" stroke="#8ea0bd" fontSize={10} interval={3} />
              <YAxis stroke="#8ea0bd" fontSize={10} width={36} />
              <Tooltip contentStyle={{ background: '#111a2e', border: '1px solid #22304d', fontSize: 12 }} />
              {metric.key === 'power_kw' && res.band && (
                <ReferenceArea y1={res.band.low} y2={res.band.high} fill="#22c55e" fillOpacity={0.08} />
              )}
              <Area type="monotone" dataKey="value" stroke={metric.color} fill={metric.color} fillOpacity={0.15} name="Actual" />
              <Line type="monotone" dataKey="baseline" stroke="#8ea0bd" strokeDasharray="4 3" dot={false} name="Baseline" />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full animate-pulse rounded bg-panel-2" />
        )}
      </div>
    </div>
  )
}

export default function EntityCharts({ entityId }) {
  if (!entityId) {
    return <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">Select a building, room or equipment to see its charts.</p>
  }
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
        Last 24 h · <span className="font-mono text-text">{entityId}</span>
      </h3>
      <div className="grid gap-3 lg:grid-cols-3">
        {METRICS.map((m) => (
          <MetricChart key={m.key + entityId} entityId={entityId} metric={m} />
        ))}
      </div>
    </div>
  )
}
