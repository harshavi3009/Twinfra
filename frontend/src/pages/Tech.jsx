import { useState } from 'react'
import { completeTicket, getTechnicians, getTickets, updateTicket } from '../api/client.js'
import SlaCountdown from '../components/SlaCountdown.jsx'
import VerificationBadge from '../components/VerificationBadge.jsx'
import { usePolling } from '../hooks/usePolling.js'

// Mobile technician view: rendered WITHOUT the sidebar. No login; the picked name is remembered on this phone.
const TECH_KEY = 'twinfra.techId'
const FINISHED = ['done', 'closed']

export default function Tech() {
  const { data: techs } = usePolling(getTechnicians)
  const { data: tickets, error } = usePolling(() => getTickets())
  const [techId, setTechId] = useState(() => localStorage.getItem(TECH_KEY) || '')
  const [completing, setCompleting] = useState(null) // ticket id with the completion form open
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const pick = (id) => {
    setTechId(id)
    localStorage.setItem(TECH_KEY, id)
  }

  const run = (promise) => {
    setBusy(true)
    setMsg('')
    return promise.catch((e) => setMsg(e.message)).finally(() => setBusy(false))
  }

  const start = (ticket) => run(updateTicket(ticket.id, { status: 'in_progress' }))

  // Close the form only when the fix was accepted, so a failed upload keeps the note and photo.
  const submitFix = (ticket) => {
    setBusy(true)
    setMsg('')
    completeTicket(ticket.id, note.trim() || 'Completed', photo)
      .then(() => {
        setCompleting(null)
        setNote('')
        setPhoto(null)
      })
      .catch((e) => setMsg(e.message))
      .finally(() => setBusy(false))
  }

  if (!techId) {
    return (
      <div className="mx-auto min-h-full max-w-md p-4">
        <h1 className="text-xl font-bold text-accent">Twinfra · Technician</h1>
        <p className="mt-2 text-muted">Who are you?</p>
        <div className="mt-4 flex flex-col gap-2">
          {(techs || []).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => pick(t.id)}
              className="rounded-lg border border-line bg-panel p-4 text-left text-lg font-semibold"
            >
              {t.name}
              <span className="block text-xs font-normal capitalize text-muted">{t.skill}</span>
            </button>
          ))}
          {!techs && <div className="h-16 animate-pulse rounded-lg bg-panel" />}
        </div>
      </div>
    )
  }

  const me = techs?.find((t) => t.id === techId)
  const mine = (tickets || []).filter((t) => t.technician?.id === techId)
  const active = mine.filter((t) => !FINISHED.includes(t.status))
  const finished = mine.filter((t) => FINISHED.includes(t.status))

  return (
    <div className="mx-auto min-h-full max-w-md space-y-4 p-4 text-base">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">Technician</div>
          <div className="text-xl font-bold">{me?.name || 'Unknown'}</div>
        </div>
        <button type="button" onClick={() => pick('')} className="text-sm text-accent">
          Switch
        </button>
      </div>

      {error && !tickets && <p className="text-critical">Could not load tickets: {error}</p>}
      {msg && <p className="rounded-md border border-critical/50 bg-critical/10 p-3 text-sm text-critical">{msg}</p>}

      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">My jobs ({active.length})</h2>
      {active.length === 0 && <p className="text-muted">No open jobs. Nice work.</p>}

      {active.map((t) => (
        <div key={t.id} className="rounded-lg border border-line bg-panel p-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase text-warning">{t.priority}</span>
            <span className="font-mono text-xs text-muted">{t.id}</span>
            <span className="ml-auto text-xs capitalize text-muted">{t.status.replace('_', ' ')}</span>
          </div>
          <div className="mt-1 text-lg font-semibold">{t.title}</div>
          <div className="mt-1 font-mono text-xs text-muted">{t.equipment_id || t.entity_id}</div>
          <div className="mt-2">
            <SlaCountdown ticket={t} />
          </div>

          {completing === t.id ? (
            <div className="mt-4 space-y-3">
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What did you fix?"
                className="w-full rounded border border-line bg-panel-2 p-3 text-base text-text"
              />
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setPhoto(e.target.files?.[0] || null)}
                className="block w-full text-sm text-muted file:mr-3 file:rounded file:border-0 file:bg-panel-2 file:px-3 file:py-2 file:text-text"
              />
              {photo && <div className="text-xs text-muted">Photo: {photo.name}</div>}
              <button
                type="button"
                disabled={busy}
                onClick={() => submitFix(t)}
                className="w-full rounded-lg bg-ok py-3 text-base font-semibold text-bg disabled:opacity-50"
              >
                {busy ? 'Submitting…' : 'Submit fix'}
              </button>
              <button type="button" onClick={() => setCompleting(null)} className="w-full py-2 text-sm text-muted">
                Cancel
              </button>
            </div>
          ) : (
            <div className="mt-4 flex gap-2">
              {t.status === 'assigned' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => start(t)}
                  className="flex-1 rounded-lg border border-accent py-3 font-semibold text-accent disabled:opacity-50"
                >
                  Start
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => setCompleting(t.id)}
                className="flex-1 rounded-lg bg-accent py-3 font-semibold text-bg disabled:opacity-50"
              >
                Complete
              </button>
            </div>
          )}
        </div>
      ))}

      {finished.length > 0 && (
        <>
          <h2 className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted">Finished</h2>
          {finished.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-panel p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{t.title}</div>
                <div className="font-mono text-xs text-muted">{t.id}</div>
              </div>
              <VerificationBadge verification={t.verification} />
            </div>
          ))}
        </>
      )}
    </div>
  )
}
