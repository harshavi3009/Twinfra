import { getAssetHealthReport, getSustainabilityReport } from '../api/client.js'
import { usePolling } from '../hooks/usePolling.js'

const GRADE_STYLE = {
  A: 'text-ok border-ok/50',
  B: 'text-ok border-ok/30',
  C: 'text-warning border-warning/50',
  D: 'text-critical border-critical/50',
  F: 'text-critical border-critical/70',
}

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-mono text-2xl font-medium">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  )
}

export default function Reports() {
  const { data: sus, error: susErr } = usePolling(() => getSustainabilityReport(30), 60000)
  const { data: health, error: healthErr } = usePolling(getAssetHealthReport, 60000)
  const n = (v) => Math.round(v).toLocaleString('en-IN')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between no-print">
        <h1 className="text-2xl font-bold">Reports</h1>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-bg hover:opacity-90"
        >
          Download PDF
        </button>
      </div>

      <section className="report-section">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Sustainability · last 30 days</h2>
        {susErr && !sus && <p className="text-critical">Could not load report: {susErr}</p>}
        {!sus && !susErr && <div className="h-24 animate-pulse rounded-lg bg-panel" />}
        {sus && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Energy" value={`${n(sus.kwh)} kWh`} sub={`${sus.vs_prev_pct > 0 ? '↑' : '↓'} ${Math.abs(sus.vs_prev_pct)}% vs previous 30 days`} />
              <Stat label="Cost" value={`₹${n(sus.cost_inr)}`} sub="Tariff ₹9/kWh (assumed)" />
              <Stat label="CO₂" value={`${n(sus.co2_kg)} kg`} sub="Factor 0.71 kg/kWh (assumed)" />
              <Stat label="Water" value={`${n(sus.water_kl)} kL`} />
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Stat label="Sustainability score" value={`${sus.score}/100`} />
              <Stat label="Equivalent" value={`≈ ${n(sus.trees_equiv)} trees`} sub="Trees to absorb this CO₂ in a year (assumed)" />
            </div>
            <div className="mt-3 rounded-lg border border-line bg-panel p-4">
              <div className="mb-2 text-xs uppercase tracking-wide text-muted">Energy by building</div>
              {sus.by_building.map((b) => (
                <div key={b.id} className="flex justify-between border-t border-line py-1.5 text-sm first:border-t-0">
                  <span>{b.name}</span>
                  <span className="font-mono">{n(b.kwh)} kWh</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="report-section">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Asset health</h2>
        {healthErr && !health && <p className="text-critical">Could not load report: {healthErr}</p>}
        {!health && !healthErr && <div className="h-24 animate-pulse rounded-lg bg-panel" />}
        {health && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid grid-cols-3 gap-2">
              {health.buildings.map((b) => (
                <div key={b.id} className={`rounded-lg border bg-panel p-3 text-center ${GRADE_STYLE[b.grade]}`}>
                  <div className="font-mono text-xs text-muted">{b.id}</div>
                  <div className="text-3xl font-bold">{b.grade}</div>
                  <div className="font-mono text-xs text-muted">{b.score}/100</div>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-line bg-panel p-4">
              <div className="mb-2 text-xs uppercase tracking-wide text-muted">Worst assets</div>
              {health.worst_assets.map((a) => (
                <div key={a.id} className="border-t border-line py-2 first:border-t-0">
                  <div className="flex justify-between text-sm font-medium">
                    <span>{a.name}</span>
                    <span className="font-mono text-critical">{Math.round(a.risk * 100)}% risk</span>
                  </div>
                  <div className="text-xs text-muted">{a.reason}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <footer className="border-t border-line pt-3 text-xs text-muted">
        Synthetic data · tariff ₹9/kWh assumed · grid emission factor 0.71 kg CO₂/kWh assumed
      </footer>
    </div>
  )
}
