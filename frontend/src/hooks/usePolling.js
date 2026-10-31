import { useEffect, useRef, useState } from 'react'

export const POLL_MS = 3000

// Calls fetcher() now and then every `ms`. Keeps the last good data if a poll fails.
export function usePolling(fetcher, ms = POLL_MS) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const fetchRef = useRef(fetcher)
  fetchRef.current = fetcher

  useEffect(() => {
    let alive = true
    const tick = () =>
      fetchRef
        .current()
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e) => alive && setError(e.message))
    tick()
    const t = setInterval(tick, ms)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [ms])

  return { data, error }
}
