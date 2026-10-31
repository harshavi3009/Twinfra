const SEVERITY_STYLE = {
  critical: 'border-critical/50 bg-critical/10 text-critical',
  high: 'border-warning/50 bg-warning/10 text-warning',
  medium: 'border-warning/30 bg-warning/5 text-warning',
  low: 'border-line bg-panel-2 text-muted',
}

const KIND_LABEL = { spike: 'Spike', ghost_load: 'Ghost load', night_leak: 'Night leak', drift: 'Drift' }

export default function AlertCard({ alert, onSelect, className = '', large = false }) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(alert.entity_id)}
      className={`w-full rounded-lg border border-line bg-panel p-3 text-left transition-colors hover:border-accent/50 ${className}`}
    >
      <div className="flex items-center gap-2">
        <span className={`rounded border px-1.5 py-0.5 font-semibold uppercase ${large ? 'text-sm' : 'text-[10px]'} ${SEVERITY_STYLE[alert.severity]}`}>
          {alert.severity}
        </span>
        <span className={`font-semibold ${large ? 'text-xl' : 'text-sm'}`}>{alert.entity_name}</span>
        <span className={`ml-auto text-muted ${large ? 'text-base' : 'text-xs'}`}>{KIND_LABEL[alert.kind] || alert.kind}</span>
      </div>
      <p className={`mt-1.5 text-muted ${large ? 'text-lg' : 'text-sm'}`}>{alert.explanation}</p>
      <div className={`mt-2 flex items-center gap-3 font-mono ${large ? 'text-base' : 'text-xs'}`}>
        <span className="text-critical">
          ₹{alert.est_cost_inr_month?.toLocaleString('en-IN')}/mo
        </span>
        {alert.ticket_id && <span className="text-accent">{alert.ticket_id}</span>}
        <span className={`ml-auto text-muted ${large ? 'text-base' : 'text-xs'}`}>{new Date(alert.ts).toLocaleTimeString()}</span>
      </div>
    </button>
  )
}
