import { useEffect, useState } from 'react'

// Returns true once `ms` milliseconds have passed. Used to mount HTML labels one at a time.
export function useDelayedReady(ms) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setReady(true), ms)
    return () => clearTimeout(t)
  }, [ms])
  return ready
}
