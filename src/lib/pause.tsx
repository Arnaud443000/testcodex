import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from './api'
import { remainingMinutes } from './pauseView'
import type { CurrentPause, NewPause, PauseSettings } from '../types/pause'

/**
 * Pause volontaire (lot 35), côté interface : le repère de la coque, le minuteur et les actions.
 * Un RAPPEL, jamais un blocage : rien de ce qui est ici n'empêche de saisir ou d'enregistrer un trade.
 *
 * Tout vient de pulse-core (`get_current_pause`) : la pause est faite de deux horodatages, elle se termine
 * d'elle-même à l'heure dite et survit à un redémarrage. Ici, on relit la base à l'ouverture, toutes les
 * minutes et au retour sur la fenêtre, on recalcule les minutes restantes chaque minute, et un minuteur
 * retire le repère à la seconde près de la fin. Le provider n'est monté que déverrouillé (aucune requête
 * tant que l'application est verrouillée).
 */

interface PauseCtx {
  /** La pause qui court maintenant (fin non atteinte), sinon `null`. */
  current: CurrentPause | null
  /** Minutes restantes de la pause en cours (0 sans pause). */
  remainingMin: number
  settings: PauseSettings | null
  /** Incrémenté à chaque démarrage ou fin : les cartes qui listent les pauses se rechargent. */
  changes: number
  start: (pause: NewPause) => Promise<void>
  end: () => Promise<void>
  refreshSettings: () => Promise<void>
}

const Ctx = createContext<PauseCtx | null>(null)
const MINUTE = 60_000

export function PauseProvider({ children }: { children: ReactNode }) {
  const [fetched, setFetched] = useState<CurrentPause | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [settings, setSettings] = useState<PauseSettings | null>(null)
  const [changes, setChanges] = useState(0)
  const live = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const c = await api.getCurrentPause()
      if (live.current) {
        setFetched(c)
        setNow(Date.now())
      }
    } catch {
      if (live.current) setFetched(null)
    }
  }, [])

  const refreshSettings = useCallback(async () => {
    try {
      const s = await api.getPauseSettings()
      if (live.current) setSettings(s)
    } catch {
      /* les réglages gardent leurs valeurs par défaut côté pulse-core */
    }
  }, [])

  useEffect(() => {
    live.current = true
    void refresh()
    void refreshSettings()
    const tick = () => {
      setNow(Date.now())
      void refresh()
    }
    const timer = setInterval(tick, MINUTE)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      live.current = false
      clearInterval(timer)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [refresh, refreshSettings])

  // Une pause encore en cours à l'instant `now`, jamais au-delà de sa fin (fin exclue).
  const current = fetched && fetched.pause.plannedEndAt > now ? fetched : null

  // Le repère disparaît à l'heure dite, sans attendre le prochain passage de la minute.
  const endAt = current?.pause.plannedEndAt ?? null
  useEffect(() => {
    if (endAt === null) return
    const delay = Math.min(Math.max(endAt - Date.now(), 0) + 50, 2_147_000_000)
    const timer = setTimeout(() => {
      setNow(Date.now())
      void refresh()
    }, delay)
    return () => clearTimeout(timer)
  }, [endAt, refresh])

  const start = useCallback(
    async (pause: NewPause) => {
      await api.startPause(pause)
      setChanges((n) => n + 1)
      await refresh()
    },
    [refresh],
  )
  const end = useCallback(async () => {
    await api.endPause()
    setChanges((n) => n + 1)
    await refresh()
  }, [refresh])

  const value = useMemo<PauseCtx>(
    () => ({ current, remainingMin: current ? remainingMinutes(current.pause.plannedEndAt, now) : 0, settings, changes, start, end, refreshSettings }),
    [current, now, settings, changes, start, end, refreshSettings],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePause(): PauseCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePause must be used inside PauseProvider')
  return v
}
