import { useEffect, useState } from 'react'
import { getTechnicians, suggestTechnicians, updateTicket } from '../api/client.js'
import SlaCountdown from './SlaCountdown.jsx'
import VerificationBadge from './VerificationBadge.jsx'

const STATUS_BUTTONS = [
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'closed', label: 'Closed' },
]

export default function TicketDrawer({ ticket, onClose }) {
  const [techs, setTechs] = useState([])
  const [suggested, setSuggested] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const id = ticket?.id

  // Suggestions come first in the Assign dropdown, each with its reason.
  useEffect(() => {
    if (!id) return
    let alive = true
    getTechnicians().then((t) => alive && setTechs(t)).catch(() => {})
    suggestTechnicians(id).then((s) => alive && setSuggested(s)).catch(() => {})
    return () => {
      alive = false
    }
  }, [id])

  if (!ticket) return null

  const change = (body) => {
    setBusy(true)
    setError('')
    updateTicket(ticket.id, body)
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false))
  }

  const suggestedIds = new Set(suggested.map((s) => s.id))

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-md space-y-5 overflow-auto border-l border-line bg-panel p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-xs text-muted">{ticket.id}</div>
            <h2 className="text-lg font-semibold">{ticket.title}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-text">
            ✕
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded border border-line px-1.5 py-0.5 uppercase">{ticket.priority}</span>
          <span className="rounded border border-line px-1.5 py-0.5 uppercase">{ticket.source}</span>
          {ticket.escalated && <span className="rounded bg-critical px-1.5 py-0.5 font-bold text-white">ESCALATED</span>}
          <VerificationBadge verification={ticket.verification} />
        </div>

        {ticket.status !== 'done' && ticket.status !== 'closed' && <SlaCountdown ticket={ticket} />}

        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Description</h3>
          <p className="text-sm">{ticket.description || 'No description.'}</p>
          {ticket.evidence?.explanation && (
            <div className="mt-2 rounded-md border border-line bg-panel-2 p-3 text-sm text-muted">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide">Evidence</div>
              {ticket.evidence.explanation}
            </div>
          )}
        </section>

        <section>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="assign">
            Assign technician
          </label>
          <select
            id="assign"
            disabled={busy}
            value={ticket.technician?.id || ''}
            onChange={(e) => change({ technician_id: e.target.value || null })}
            className="w-full rounded border border-line bg-panel-2 px-2 py-2 text-sm text-text"
          >
            <option value="">Unassigned</option>
            {suggested.length > 0 && (
              <optgroup label="Suggested">
                {suggested.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.reason}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="All technicians">
              {techs.filter((t) => !suggestedIds.has(t.id)).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.skill} · {t.active_tickets} active
                </option>
              ))}
            </optgroup>
          </select>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Set status</h3>
          <div className="flex flex-wrap gap-2">
            {STATUS_BUTTONS.map((s) => (
              <button
                key={s.value}
                type="button"
                disabled={busy || ticket.status === s.value}
                onClick={() => change({ status: s.value })}
                className="rounded border border-line px-3 py-1.5 text-sm hover:border-accent/60 disabled:opacity-40"
              >
                {s.label}
              </button>
            ))}
          </div>
        </section>

        {ticket.completion_note && (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Technician note</h3>
            <p className="text-sm">{ticket.completion_note}</p>
            {ticket.completion_photo && <img src={ticket.completion_photo} alt="Completion" className="mt-2 rounded-md" />}
          </section>
        )}

        {error && <p className="text-sm text-critical">{error}</p>}
      </aside>
    </div>
  )
}
