import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAlerts } from '../api/client.js'
import AlertCard from '../components/AlertCard.jsx'
import { usePolling } from '../hooks/usePolling.js'

const KINDS = ['spike', 'ghost_load', 'night_leak', 'drift']
const SEVERITIES = ['critical', 'high', 'medium', 'low']
const BUILDINGS = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']

function Select({ label, value, onChange, options }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-line bg-panel px-2 py-1.5 text-sm text-text"
      >
        <option value="">All</option>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </label>
  )
}

export default function Alerts() {
  const { data: alerts, error } = usePolling(() => getAlerts(true))
  const [kind, setKind] = useState('')
  const [severity, setSeverity] = useState('')
  const [building, setBuilding] = useState('')
  const navigate = useNavigate()

  const shown = (alerts || []).filter(
    (a) =>
      (!kind || a.kind === kind) &&
      (!severity || a.severity === severity) &&
      (!building || a.entity_id.split('-')[0] === building),
  )

  return (
    <div>
      <h1 className="text-2xl font-bold">Alerts</h1>
      <div className="mt-4 flex flex-wrap gap-3">
        <Select label="Kind" value={kind} onChange={setKind} options={KINDS} />
        <Select label="Severity" value={severity} onChange={setSeverity} options={SEVERITIES} />
        <Select label="Building" value={building} onChange={setBuilding} options={BUILDINGS} />
      </div>
      {error && !alerts && <p className="mt-4 text-critical">Could not load alerts: {error}</p>}
      {!alerts && !error && <div className="mt-4 h-24 animate-pulse rounded-lg bg-panel" />}
      <div className="mt-4 grid max-w-3xl gap-2">
        {shown.map((a) => (
          <AlertCard key={a.id} alert={a} onSelect={(id) => navigate('/', { state: { entityId: id } })} />
        ))}
      </div>
      {alerts && shown.length === 0 && <p className="mt-4 text-sm text-muted">No alerts match these filters.</p>}
    </div>
  )
}
