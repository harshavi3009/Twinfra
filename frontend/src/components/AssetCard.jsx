const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`

const CRIT_STYLE = {
  critical: 'border-critical/50 bg-critical/10 text-critical',
  high: 'border-warning/50 bg-warning/10 text-warning',
  medium: 'border-accent/40 bg-accent/10 text-accent',
  low: 'border-line bg-panel-2 text-muted',
}

export default function AssetCard({ eq, onCreateTicket }) {
  const faulty = eq.status === 'fault' || eq.prediction?.risk >= 0.7 || !!eq.open_ticket_id
  const warrantyValid = eq.warranty_days_left > 0
  const warrantyRed = warrantyValid && eq.warranty_days_left < 30

  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-lg font-semibold">{eq.name}</div>
          <div className="font-mono text-xs text-muted">
            {eq.id} · {eq.eq_type} · {eq.room_id}
          </div>
        </div>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${CRIT_STYLE[eq.criticality]}`}>
          {eq.criticality}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">Owner</dt>
        <dd>{eq.owner_name} · {eq.owner_dept}</dd>
        <dt className="text-muted">Power</dt>
        <dd className={`font-mono ${eq.power_kw > eq.rated_kw ? 'text-critical' : ''}`}>
          {eq.power_kw} kW <span className="text-muted">(rated {eq.rated_kw})</span>
        </dd>
        <dt className="text-muted">Installed</dt>
        <dd className="font-mono">{eq.install_date}</dd>
        <dt className="text-muted">Replacement</dt>
        <dd className="font-mono">{inr(eq.replacement_cost)}</dd>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-2 py-0.5 text-xs ${
            !warrantyValid
              ? 'border-line text-muted'
              : warrantyRed
                ? 'border-critical/50 bg-critical/10 text-critical'
                : 'border-ok/40 bg-ok/10 text-ok'
          }`}
        >
          {warrantyValid ? `Warranty: ${eq.warranty_days_left} days left` : 'Warranty expired'}
        </span>
        {faulty && warrantyValid && (
          <button type="button" className="rounded-full bg-accent px-3 py-0.5 text-xs font-semibold text-bg">
            Claim under warranty
          </button>
        )}
      </div>

      {eq.prediction && (
        <div className="mt-4 rounded-md border border-line bg-panel-2 p-3">
          <div className="text-xs uppercase tracking-wide text-muted">Failure prediction</div>
          <div className={`mt-1 text-sm font-semibold ${eq.prediction.risk >= 0.7 ? 'text-critical' : 'text-warning'}`}>
            Likely to fail in ~{eq.prediction.days_to_failure} days{' '}
            <span className="font-mono text-xs">(risk {Math.round(eq.prediction.risk * 100)}%)</span>
          </div>
          <ul className="mt-1 list-inside list-disc text-xs text-muted">
            {eq.prediction.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <div className="text-xs uppercase tracking-wide text-muted">Maintenance history</div>
        <ol className="mt-2 space-y-2 border-l border-line pl-3">
          {eq.history.map((h) => (
            <li key={h.date + h.action} className="relative text-sm">
              <span className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-accent" />
              <span className="font-mono text-xs text-muted">{h.date}</span>{' '}
              <span className="font-medium capitalize">{h.action.replace('_', ' ')}</span>
              <span className="text-muted"> · {inr(h.cost)} · {h.notes}</span>
            </li>
          ))}
          {eq.history.length === 0 && <li className="text-sm text-muted">No history.</li>}
        </ol>
      </div>

      <div className="mt-4 flex items-center gap-3">
        {eq.open_ticket_id ? (
          <span className="font-mono text-sm text-accent">Open ticket {eq.open_ticket_id}</span>
        ) : (
          <button
            type="button"
            onClick={() => onCreateTicket?.(eq)}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-bg hover:opacity-90"
          >
            Create ticket
          </button>
        )}
      </div>
    </div>
  )
}
