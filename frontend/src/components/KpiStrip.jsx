const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`

// Each card gets its own colour pair (start -> end of the gradient). Medium saturation, so they sit well on grey.
const GRADIENTS = {
  indigo: ['#4f46e5', '#7c74f0'],
  ocean: ['#0e7490', '#2b8ba6'],
  teal: ['#0f766e', '#2a9d8f'],
  berry: ['#9d174d', '#be4b7a'],
  amber: ['#b45309', '#d9822b'],
  purple: ['#6d28d9', '#8b5cf6'],
}

function Kpi({ label, value, unit, sub, color }) {
  const [from, to] = GRADIENTS[color]
  return (
    <div
      className="rounded-lg p-4 text-white shadow-lg"
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      <div className="text-xs uppercase tracking-wide text-white/80">{label}</div>
      <div className="mt-1 font-mono text-2xl font-medium">
        {value}
        {unit && <span className="ml-1 text-sm text-white/80">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-xs text-white/80">{sub}</div>}
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
        color="indigo"
        sub={`${over > 0 ? '↑' : '↓'} ${Math.abs(over).toFixed(1)}% vs baseline ${totals.baseline_kw} kW`}
      />
      <Kpi label="Water" value={totals.water_lpm} unit="L/min" color="ocean" />
      <Kpi label="Occupancy" value={totals.occupancy.toLocaleString('en-IN')} color="teal" />
      <Kpi label="Active alerts" value={totals.active_alerts} color="berry" />
      <Kpi label="Open tickets" value={totals.open_tickets} color="amber" />
      <Kpi label="₹ wasted / month (est.)" value={inr(wasted)} color="purple" sub="Sum of active alerts" />
    </div>
  )
}
