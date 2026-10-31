import { useEffect, useState } from 'react'
import { getCampus } from '../api/client.js'
import { Campus3D } from '../campus3d/index.jsx'

function Kpi({ label, value, unit, tone = 'text-text' }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-medium ${tone}`}>
        {value}
        {unit && <span className="ml-1 text-sm text-muted">{unit}</span>}
      </div>
    </div>
  )
}

export default function Overview() {
  const [campus, setCampus] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    getCampus().then(setCampus).catch((e) => setError(e.message))
  }, [])

  if (error) return <p className="text-critical">Could not load campus: {error}</p>
  if (!campus) return <p className="text-muted">Loading…</p>

  const t = campus.totals
  const overPct = ((t.power_kw / t.baseline_kw - 1) * 100).toFixed(1)

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Power now" value={t.power_kw} unit="kW" tone={overPct > 0 ? 'text-critical' : 'text-ok'} />
        <Kpi label="vs baseline" value={`${overPct > 0 ? '↑' : '↓'} ${Math.abs(overPct)}`} unit="%" tone={overPct > 0 ? 'text-critical' : 'text-ok'} />
        <Kpi label="Water" value={t.water_lpm} unit="L/min" />
        <Kpi label="Occupancy" value={t.occupancy} />
        <Kpi label="Active alerts" value={t.active_alerts} tone="text-warning" />
      </div>
      <div className="min-h-64 flex-1">
        <Campus3D campus={campus} selection={null} onSelect={() => {}} />
      </div>
    </div>
  )
}
