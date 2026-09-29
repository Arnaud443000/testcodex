import { useEffect, useState } from 'react'

/** Charge un rapport de pulse-core quand `enabled` (onglet ouvert) et le recharge quand `deps` change. */
export function useReport<T>(load: () => Promise<T>, deps: unknown[], enabled: boolean): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null })
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setState({ data: null, error: null })
    load()
      .then((data) => !cancelled && setState({ data, error: null }))
      .catch((e) => !cancelled && setState({ data: null, error: String(e) }))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])
  return state
}
