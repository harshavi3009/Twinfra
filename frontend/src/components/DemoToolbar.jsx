import { useEffect, useState } from 'react'
import { getCampus, injectFault } from '../api/client.js'

const KINDS = ['spike', 'ghost_load', 'night_leak']

// Small collapsible toolbar to trigger the demo moment on cue.
export default function DemoToolbar() {
  const [open, setOpen] = useState(false)
  const [entities, setEntities] = useState([])
  const [entity, setEntity] = useState('B1')
  const [kind, setKind] = useState('ghost_load')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    getCampus().then((c) => setEntities(c.buildings.map((b) => b.id))).catch(() => {})
  }, [])

  const inject = async () => {
    try {
      await injectFault(entity, kind)
      setMsg(`Injected ${kind} on ${entity}`)
    } catch (e) {
      setMsg(e.message)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-muted hover:text-accent"
      >
        Demo tools
      </button>
    )
  }

  const field = 'rounded border border-line bg-panel-2 px-2 py-1 text-sm text-text'
  return (
    <div className="fixed bottom-4 right-4 z-40 w-64 rounded-lg border border-line bg-panel p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Inject fault</span>
        <button type="button" onClick={() => setOpen(false)} className="text-muted hover:text-text">✕</button>
      </div>
      <div className="flex flex-col gap-2">
        <select className={field} value={entity} onChange={(e) => setEntity(e.target.value)}>
          {entities.map((id) => <option key={id}>{id}</option>)}
        </select>
        <select className={field} value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => <option key={k}>{k}</option>)}
        </select>
        <button type="button" onClick={inject} className="rounded bg-critical px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">
          Inject
        </button>
        {msg && <div className="text-xs text-muted">{msg}</div>}
      </div>
    </div>
  )
}
