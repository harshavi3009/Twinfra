import { useEffect, useState } from 'react'

const fmt = (s) => {
  if (s <= 0) return 'Overdue'
  const h = Math.floor(s / 3600)
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const sec = String(s % 60).padStart(2, '0')
  return `${h}h ${m}m ${sec}s`
}

// Live countdown to sla_due_at. Turns red once less than 20% of the SLA window is left.
export default function SlaCountdown({ ticket }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const due = new Date(ticket.sla_due_at).getTime()
  const totalS = (due - new Date(ticket.created_at).getTime()) / 1000
  const left = Math.max(0, Math.round((due - now) / 1000))
  const urgent = left === 0 || (totalS > 0 && left / totalS < 0.2)

  return <span className={`font-mono text-xs ${urgent ? 'text-critical' : 'text-muted'}`}>SLA {fmt(left)}</span>
}
