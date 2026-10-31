import { useState } from 'react'
import { getTickets } from '../api/client.js'
import CreateTicketModal from '../components/CreateTicketModal.jsx'
import TicketCard from '../components/TicketCard.jsx'
import TicketDrawer from '../components/TicketDrawer.jsx'
import { usePolling } from '../hooks/usePolling.js'

const COLUMNS = [
  { label: 'Open', statuses: ['open'] },
  { label: 'Assigned', statuses: ['assigned'] },
  { label: 'In progress', statuses: ['in_progress'] },
  { label: 'Done', statuses: ['done', 'closed'] },
]

export default function Tickets() {
  const { data: tickets, error } = usePolling(() => getTickets())
  const [openId, setOpenId] = useState(null)
  const [creating, setCreating] = useState(false)

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Tickets</h1>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-bg hover:opacity-90"
        >
          New ticket
        </button>
      </div>

      {error && !tickets && <p className="mt-4 text-critical">Could not load tickets: {error}</p>}
      {!tickets && !error && <div className="mt-4 h-24 animate-pulse rounded-lg bg-panel" />}

      <div className="mt-4 grid gap-4 lg:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = (tickets || []).filter((t) => col.statuses.includes(t.status))
          return (
            <section key={col.label} className="min-h-40 rounded-lg border border-line bg-panel/50 p-3">
              <h2 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted">
                {col.label}
                <span className="font-mono">{items.length}</span>
              </h2>
              <div className="flex flex-col gap-2">
                {items.map((t) => (
                  <TicketCard key={t.id} ticket={t} onOpen={setOpenId} />
                ))}
              </div>
            </section>
          )
        })}
      </div>

      <TicketDrawer ticket={tickets?.find((t) => t.id === openId)} onClose={() => setOpenId(null)} />
      {creating && <CreateTicketModal onClose={() => setCreating(false)} onCreated={() => setCreating(false)} />}
    </div>
  )
}
