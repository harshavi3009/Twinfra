const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`

function Kpi({ label, value, unit, sub, tone = 'text-text' }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-medium ${tone}`}>
        {value}
        {unit && <span className="ml-1 text-sm text-muted">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  )
}

export default function KpiStrip({ totals, alerts }) {
  const over = (totals.power_kw / totals.baseline_kw - 1) * 100
  const wasted = (alerts || []).reduce((s, a) => s + (a.est_cost_inr_month || 0), 0)
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi
        label="Power now"
        value={totals.power_kw}
        unit="kW"
        tone={over > 0 ? 'text-critical' : 'text-ok'}
        sub={`${over > 0 ? '↑' : '↓'} ${Math.abs(over).toFixed(1)}% vs baseline ${totals.baseline_kw} kW`}
      />
      <Kpi label="Water" value={totals.water_lpm} unit="L/min" />
      <Kpi label="Occupancy" value={totals.occupancy.toLocaleString('en-IN')} />
      <Kpi label="Active alerts" value={totals.active_alerts} tone={totals.active_alerts ? 'text-warning' : 'text-ok'} />
      <Kpi label="Open tickets" value={totals.open_tickets} />
      <Kpi label="₹ wasted / month (est.)" value={inr(wasted)} tone="text-critical" sub="Sum of active alerts" />
    </div>
  )
}
