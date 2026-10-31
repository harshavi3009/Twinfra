import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/alerts', label: 'Alerts' },
  { to: '/tickets', label: 'Tickets' },
  { to: '/insights', label: 'Insights' },
  { to: '/reports', label: 'Reports' },
  { to: '/import', label: 'Import' },
]

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return <span className="font-mono text-sm text-muted">{now.toLocaleTimeString()}</span>
}

export default function Layout() {
  return (
    <div className="flex h-full">
      <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-panel">
        <div className="px-5 py-5">
          <div className="text-xl font-bold tracking-tight text-accent">Twinfra</div>
          <div className="text-xs text-muted">Campus digital twin</div>
        </div>
        <nav className="flex flex-col gap-1 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-panel-2 text-accent' : 'text-muted hover:bg-panel-2 hover:text-text'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-panel px-6 py-3">
          <div className="font-semibold">Twinfra</div>
          <div className="flex items-center gap-4">
            <span className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-xs text-warning">
              Synthetic data
            </span>
            <span className="flex items-center gap-1.5 text-xs font-semibold text-ok">
              <span className="live-dot inline-block h-2 w-2 rounded-full bg-ok" /> LIVE
            </span>
            <Clock />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
