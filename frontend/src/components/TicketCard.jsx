import SlaCountdown from './SlaCountdown.jsx'
import VerificationBadge from './VerificationBadge.jsx'

const PRIORITY_STYLE = {
  critical: 'border-critical/50 text-critical',
  high: 'border-warning/50 text-warning',
  medium: 'border-accent/40 text-accent',
  low: 'border-line text-muted',
}

export default function TicketCard({ ticket, onOpen }) {
  const done = ticket.status === 'done' || ticket.status === 'closed'
  return (
    <button
      type="button"
      onClick={() => onOpen(ticket.id)}
      className="w-full rounded-lg border border-line bg-panel p-3 text-left transition-colors hover:border-accent/50"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${PRIORITY_STYLE[ticket.priority]}`}>
          {ticket.priority}
        </span>
        {ticket.source === 'auto' && (
          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">AUTO</span>
        )}
        {ticket.escalated && (
          <span className="rounded bg-critical px-1.5 py-0.5 text-[10px] font-bold text-white">ESCALATED</span>
        )}
      </div>
      <div className="mt-2 text-sm font-semibold">{ticket.title}</div>
      <div className="mt-0.5 font-mono text-xs text-muted">
        {ticket.id} · {ticket.equipment_id || ticket.entity_id}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted">{ticket.technician ? ticket.technician.name : 'Unassigned'}</span>
        {!done && <SlaCountdown ticket={ticket} />}
      </div>
      {done && ticket.verification !== 'none' && (
        <div className="mt-2">
          <VerificationBadge verification={ticket.verification} />
        </div>
      )}
    </button>
  )
}
