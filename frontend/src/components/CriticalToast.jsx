import { useEffect, useRef, useState } from 'react'
import { getAlerts } from '../api/client.js'
import { usePolling } from '../hooks/usePolling.js'

// Pops a toast when a NEW critical alert shows up. Alerts present at first load are ignored.
export default function CriticalToast() {
  const { data: alerts } = usePolling(() => getAlerts(true))
  const seen = useRef(null)
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    if (!alerts) return
    if (seen.current === null) {
      seen.current = new Set(alerts.map((a) => a.id))
      return
    }
    const fresh = alerts.filter((a) => a.severity === 'critical' && !seen.current.has(a.id))
    alerts.forEach((a) => seen.current.add(a.id))
    if (fresh.length === 0) return
    setToasts((t) => [...t, ...fresh])
    fresh.forEach((a) => setTimeout(() => setToasts((t) => t.filter((x) => x.id !== a.id)), 8000))
  }, [alerts])

  return (
    <div className="pointer-events-none fixed right-4 top-16 z-50 flex w-80 flex-col gap-2">
      {toasts.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => setToasts((t) => t.filter((x) => x.id !== a.id))}
          className="pointer-events-auto rounded-lg border border-critical bg-panel p-3 text-left shadow-lg shadow-critical/20"
        >
          <div className="text-xs font-bold uppercase tracking-wide text-critical">● Critical alert</div>
          <div className="mt-0.5 text-sm font-semibold">{a.entity_name}</div>
          <div className="text-xs text-muted">{a.explanation}</div>
        </button>
      ))}
    </div>
  )
}
