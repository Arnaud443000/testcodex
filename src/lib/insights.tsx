import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import type { Insight } from '../types/insights'
import { useAccounts } from './accounts'
import { api } from './api'
import { readSeenAt, unseenCount, writeSeenAt } from './insightsView'
import { localTzOffsetMin } from './period'

/** Rafraîchissement périodique : les insights changent à l'échelle d'un trade, pas de la minute. */
const REFRESH_MS = 5 * 60_000

interface InsightsCtx {
  /** Insights actifs (non masqués) du compte de la barre du haut ; `null` tant que le premier chargement n'est pas fini. */
  insights: Insight[] | null
  error: string | null
  refresh: () => Promise<void>
  dismiss: (id: string) => Promise<void>
  /** Nombre d'insights apparus depuis la dernière visite de la page (pastille de la barre latérale). */
  unseen: number
  /** À appeler quand la page a montré la liste : remet le compteur à zéro. */
  markSeen: () => void
}

const Ctx = createContext<InsightsCtx | null>(null)

/**
 * Les insights du compte de la barre du haut (pas la période : les fenêtres du moteur sont fixes). Chargés à
 * l'ouverture, à chaque changement de page (donc après l'enregistrement d'un trade), au retour sur la fenêtre et
 * toutes les 5 minutes. Un échec de lecture ne casse rien : la page l'affiche, la barre latérale n'a simplement pas de repère.
 */
export function InsightsProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { selectedId, loading } = useAccounts()
  const [insights, setInsights] = useState<Insight[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seenAt, setSeenAt] = useState(readSeenAt)
  const [tick, setTick] = useState(0)

  const accountIds = useMemo(() => (selectedId === null ? [] : [selectedId]), [selectedId])

  useEffect(() => {
    if (loading) return
    let live = true
    const load = () =>
      api
        .getInsights(accountIds, localTzOffsetMin())
        .then((list) => live && (setInsights(list), setError(null)))
        .catch((e) => live && setError(String(e instanceof Error ? e.message : e)))
    void load()
    const timer = setInterval(load, REFRESH_MS)
    window.addEventListener('focus', load)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('focus', load)
    }
  }, [accountIds, loading, location.pathname, tick])

  const refresh = useCallback(async () => setTick((n) => n + 1), [])
  const dismiss = useCallback(async (id: string) => {
    await api.dismissInsight(id)
    setInsights((list) => (list ? list.filter((i) => i.id !== id) : list))
  }, [])
  const markSeen = useCallback(() => {
    const now = Date.now()
    writeSeenAt(now)
    setSeenAt(now)
  }, [])

  const unseen = useMemo(() => (insights ? unseenCount(insights, seenAt) : 0), [insights, seenAt])
  const value = useMemo(() => ({ insights, error, refresh, dismiss, unseen, markSeen }), [insights, error, refresh, dismiss, unseen, markSeen])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useInsights(): InsightsCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useInsights doit être utilisé dans <InsightsProvider>')
  return c
}
