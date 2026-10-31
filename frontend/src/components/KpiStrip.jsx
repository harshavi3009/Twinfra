const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`

// Each card gets its own muted warm colour pair (start -> end of the gradient).
const GRADIENTS = {
  terracotta: ['#9c5a43', '#c07a5c'],
  caramel: ['#8f6234', '#b98656'],
  sand: ['#7d6a3c', '#a68f58'],
  rose: ['#8a4a55', '#b56f7c'],
  copper: ['#8e5130', '#b87a4f'],
  brick: ['#7f3d37', '#a85f55'],
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
        color="terracotta"
        sub={`${over > 0 ? '↑' : '↓'} ${Math.abs(over).toFixed(1)}% vs baseline ${totals.baseline_kw} kW`}
      />
      <Kpi label="Water" value={totals.water_lpm} unit="L/min" color="caramel" />
      <Kpi label="Occupancy" value={totals.occupancy.toLocaleString('en-IN')} color="sand" />
      <Kpi label="Active alerts" value={totals.active_alerts} color="rose" />
      <Kpi label="Open tickets" value={totals.open_tickets} color="copper" />
      <Kpi label="₹ wasted / month (est.)" value={inr(wasted)} color="brick" sub="Sum of active alerts" />
    </div>
  )
}
