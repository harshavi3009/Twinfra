import { useState } from 'react'
import { createTicket } from '../api/client.js'

const PRIORITIES = ['critical', 'high', 'medium', 'low']
const field = 'w-full rounded border border-line bg-panel-2 px-2 py-2 text-sm text-text'

// Manual ticket form. Opened from the asset card (prefilled) or the Tickets page (blank).
export default function CreateTicketModal({ entityId = '', equipmentId = null, title = '', onClose, onCreated }) {
  const [form, setForm] = useState({ entity_id: entityId, title, description: '', priority: 'medium' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    createTicket({ ...form, equipment_id: equipmentId || undefined })
      .then((t) => onCreated?.(t))
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-lg border border-line bg-panel p-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">New ticket</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-text">
            ✕
          </button>
        </div>

        <label className="block text-xs text-muted">
          Entity (building, room or equipment id)
          <input className={`${field} mt-1`} value={form.entity_id} onChange={set('entity_id')} required />
        </label>
        {equipmentId && <div className="font-mono text-xs text-muted">Equipment: {equipmentId}</div>}

        <label className="block text-xs text-muted">
          Title
          <input className={`${field} mt-1`} value={form.title} onChange={set('title')} required />
        </label>

        <label className="block text-xs text-muted">
          Description
          <textarea className={`${field} mt-1`} rows={3} value={form.description} onChange={set('description')} />
        </label>

        <label className="block text-xs text-muted">
          Priority (SLA)
          <select className={`${field} mt-1`} value={form.priority} onChange={set('priority')}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-sm text-critical">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-line px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !form.title.trim()}
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-bg disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create ticket'}
          </button>
        </div>
      </form>
    </div>
  )
}
