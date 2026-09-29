/**
 * Verrouillage (lot 22) côté interface : état du verrou, écoute des événements de la coque
 * (verrouillé, écriture impossible), signalement de l'activité pour le verrouillage après inactivité.
 * Aucun mot de passe n'est gardé ici : les formulaires l'envoient puis vident leur champ.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { LockStatus } from '../types/lock'
import { api, onLockedError } from './api'
import { TOUCH_INTERVAL_MS } from './lockView'

/** État de repli si la coque ne répond pas : l'application s'affiche comme avant le lot 22. */
const UNLOCKED_PLAIN: LockStatus = {
  enabled: false,
  locked: false,
  retryAfterMs: 0,
  failures: 0,
  idleMinutes: null,
  persistFailed: false,
  warning: null,
  plainCopies: [],
  minPasswordChars: 8,
}

interface LockContext {
  /** null tant que la coque n'a pas répondu. */
  status: LockStatus | null
  setStatus: (s: LockStatus) => void
  refresh: () => Promise<void>
  /** Une écriture du fichier chiffré a échoué (événement de la coque). */
  persistFailed: boolean
  clearPersistFailed: () => void
}

const Ctx = createContext<LockContext>({
  status: UNLOCKED_PLAIN,
  setStatus: () => {},
  refresh: async () => {},
  persistFailed: false,
  clearPersistFailed: () => {},
})

export function useLock() {
  return useContext(Ctx)
}

export function LockProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LockStatus | null>(null)
  const [persistFailed, setPersistFailed] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await api.getLockStatus()
      setStatus(s)
      if (s.persistFailed) setPersistFailed(true)
    } catch {
      setStatus((prev) => prev ?? UNLOCKED_PLAIN)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const offLocked = onLockedError(() => void refresh())
    let offEvents: (() => void) | null = null
    let cancelled = false
    void api
      .onLockEvents(
        () => void refresh(),
        () => setPersistFailed(true),
      )
      .then((off) => (cancelled ? off() : (offEvents = off)))
    return () => {
      cancelled = true
      offLocked()
      offEvents?.()
    }
  }, [refresh])

  // Activité réelle (clavier, souris, défilement) signalée au plus toutes les 30 s, seulement
  // quand le verrou est actif et ouvert : c'est elle qui retarde le verrouillage après inactivité.
  const lastTouch = useRef(0)
  const watching = status?.enabled === true && !status.locked
  useEffect(() => {
    if (!watching) return
    const onActivity = () => {
      const now = Date.now()
      if (now - lastTouch.current < TOUCH_INTERVAL_MS) return
      lastTouch.current = now
      void api.lockTouch().catch(() => {})
    }
    const events = ['keydown', 'mousedown', 'mousemove', 'wheel', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
    return () => events.forEach((e) => window.removeEventListener(e, onActivity))
  }, [watching])

  return (
    <Ctx.Provider value={{ status, setStatus, refresh, persistFailed, clearPersistFailed: () => setPersistFailed(false) }}>
      {children}
    </Ctx.Provider>
  )
}
