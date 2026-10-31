import { useState } from 'react'
import { getCampus, getInterventions } from '../api/client.js'
import WhatIfSimulator from '../components/WhatIfSimulator.jsx'
import { usePolling } from '../hooks/usePolling.js'
import { Campus3D } from '../campus3d/index.jsx'

const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`

export default function Insights() {
  const { data: items, error } = usePolling(getInterventions, 30000)
  const { data: campus } = usePolling(getCampus, 30000)
  // per_building from the what-if result; Campus3D recolours the buildings from it.
  const [perBuilding, setPerBuilding] = useState(null)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Insights</h1>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Ranked interventions</h2>
        {error && !items && <p className="text-critical">Could not load interventions: {error}</p>}
        {!items && !error && <div className="h-32 animate-pulse rounded-lg bg-panel" />}
        {items && (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-panel-2 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Intervention</th>
                  <th className="px-3 py-2">Risk</th>
                  <th className="px-3 py-2">Downtime</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-3 py-2 text-right">Saves / mo</th>
                  <th className="px-3 py-2 text-right">Payback</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.rank} className="border-t border-line bg-panel">
                    <td className="px-3 py-2 font-mono text-muted">{i.rank}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium" title={i.why}>
                        {i.title}
                        <span className="ml-1.5 cursor-help text-xs text-accent" title={i.why}>ⓘ</span>
                      </div>
                      <div className="font-mono text-xs text-muted">{i.entity_id}</div>
                    </td>
                    <td className="px-3 py-2 capitalize">{i.risk}</td>
                    <td className="px-3 py-2 font-mono">{i.downtime_hours == null ? '—' : `${i.downtime_hours} h`}</td>
                    <td className="px-3 py-2 text-right font-mono">{inr(i.cost_inr)}</td>
                    <td className="px-3 py-2 text-right font-mono text-ok">{inr(i.savings_inr_month)}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {i.payback_months == null ? '—' : i.payback_months === 0 ? 'Immediate' : `${i.payback_months} mo`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="h-[420px] min-w-0 rounded-lg border border-line">
          {campus ? (
            <Campus3D campus={campus} whatIf={perBuilding} />
          ) : (
            <div className="h-full animate-pulse rounded-lg bg-panel" />
          )}
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">What-if simulator</h2>
          <WhatIfSimulator onResult={setPerBuilding} />
        </div>
      </section>
    </div>
  )
}
