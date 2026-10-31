import { useEffect, useRef, useState } from 'react'
import { runWhatIf } from '../api/client.js'

// Action names match the backend's WHATIF_LIBRARY (backend/app/insights/reporting.py).
const ACTIONS = [
  { type: 'led_retrofit', label: 'LED retrofit (40% of lighting)' },
  { type: 'schedule_ac', label: 'ACs off after hours (22%)' },
  { type: 'fix_ghost_load', label: 'Eliminate ghost loads (90%)' },
  { type: 'solar_roof', label: 'Rooftop solar (15%)' },
]

const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`

function Card({ title, data, tone = 'text-text' }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <div className="text-xs uppercase tracking-wide text-muted">{title}</div>
      <div className={`mt-1 font-mono text-lg font-medium ${tone}`}>{inr(data.cost_inr)}<span className="text-xs text-muted"> /mo</span></div>
      <div className="font-mono text-xs text-muted">
        {Math.round(data.kwh_month).toLocaleString('en-IN')} kWh · {Math.round(data.co2_kg).toLocaleString('en-IN')} kg CO₂
      </div>
    </div>
  )
}

// Toggles for the four actions. Each change re-runs /api/insights/whatif (debounced).
// onResult gets the response so the page can recolour the 3D campus with per_building.
export default function WhatIfSimulator({ onResult }) {
  const [on, setOn] = useState({})
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const seq = useRef(0)

  useEffect(() => {
    const actions = ACTIONS.filter((a) => on[a.type]).map((a) => a.type)
    if (actions.length === 0) {
      setResult(null)
      onResult?.(null)
      return
    }
    const mine = ++seq.current
    const t = setTimeout(() => {
      runWhatIf(actions)
        .then((r) => {
          if (mine !== seq.current) return
          setResult(r)
          setError('')
          onResult?.(r.per_building)
        })
        .catch((e) => mine === seq.current && setError(e.message))
    }, 300)
    return () => clearTimeout(t)
    // onResult is stable enough for this demo; re-running on it would loop the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on])

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2">
        {ACTIONS.map((a) => (
          <label key={a.type} className="flex cursor-pointer items-center justify-between rounded-lg border border-line bg-panel px-3 py-2 text-sm">
            {a.label}
            <input
              type="checkbox"
              checked={!!on[a.type]}
              onChange={(e) => setOn((s) => ({ ...s, [a.type]: e.target.checked }))}
              className="h-4 w-4 accent-cyan-400"
            />
          </label>
        ))}
      </div>

      <div className="text-xs font-semibold uppercase tracking-wide text-warning">Simulated scenario</div>
      {error && <p className="text-sm text-critical">{error}</p>}
      {result ? (
        <div className="grid grid-cols-2 gap-3">
          <Card title="Before" data={result.baseline} />
          <Card title="After" data={result.scenario} tone="text-ok" />
          <div className="col-span-2 rounded-lg border border-ok/40 bg-ok/10 p-3 text-sm text-ok">
            Saves <span className="font-mono font-semibold">{inr(result.savings.cost_inr)}</span> a month ·{' '}
            <span className="font-mono">{Math.round(result.savings.kwh_month).toLocaleString('en-IN')} kWh</span> ·{' '}
            <span className="font-mono">{Math.round(result.savings.co2_kg).toLocaleString('en-IN')} kg CO₂</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">Turn on one or more actions to see the before and after.</p>
      )}
    </div>
  )
}
