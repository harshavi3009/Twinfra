const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`

// All KPI cards use the 5th tone of the blue palette (#1b3554) with white text.
const CARD_COLOR = '#1b3554'

function Kpi({ label, value, unit, sub }) {
  return (
    <div className="rounded-lg p-4 text-white shadow-lg" style={{ backgroundColor: CARD_COLOR }}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 font-mono text-2xl font-medium">
        {value}
        {unit && <span className="ml-1 text-sm opacity-80">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-xs opacity-80">{sub}</div>}
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
        sub={`${over > 0 ? '↑' : '↓'} ${Math.abs(over).toFixed(1)}% vs baseline ${totals.baseline_kw} kW`}
      />
      <Kpi label="Water" value={totals.water_lpm} unit="L/min" />
      <Kpi label="Occupancy" value={totals.occupancy.toLocaleString('en-IN')} />
      <Kpi label="Active alerts" value={totals.active_alerts} />
      <Kpi label="Open tickets" value={totals.open_tickets} />
      <Kpi label="₹ wasted / month (est.)" value={inr(wasted)} sub="Sum of active alerts" />
    </div>
  )
}
