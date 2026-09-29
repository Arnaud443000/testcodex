import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { EnginePeriod, PeriodKey } from '../types/stats'

/** Période affichée dans la barre du haut, partagée avec le tableau de bord. */
export const PERIOD_KEYS: PeriodKey[] = ['1D', '1W', '1M', '3M', '1Y', 'ALL']

/** Nom de la période côté pulse-core (`Period` dans stats/dashboard.rs). */
export const ENGINE_PERIOD: Record<PeriodKey, EnginePeriod> = {
  '1D': 'day',
  '1W': 'week',
  '1M': 'month',
  '3M': 'quarter',
  '1Y': 'year',
  ALL: 'all',
}

interface PeriodCtx {
  period: PeriodKey
  setPeriod: (p: PeriodKey) => void
}

const Ctx = createContext<PeriodCtx | null>(null)

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [period, setPeriod] = useState<PeriodKey>('3M')
  const value = useMemo(() => ({ period, setPeriod }), [period])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePeriod(): PeriodCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePeriod must be used inside PeriodProvider')
  return v
}

/** Décalage UTC de l'utilisateur en minutes (Paris l'été : +120), tel que pulse-core l'attend. */
export const localTzOffsetMin = (): number => -new Date().getTimezoneOffset()

const PERIOD_DAYS: Record<PeriodKey, number | null> = { '1D': 1, '1W': 7, '1M': 30, '3M': 90, '1Y': 365, ALL: null }
const DAY_MS = 86_400_000

/**
 * Bornes `[from, to)` en ms UTC d'une période, pour les rapports qui prennent un `StatsQuery`.
 * Même définition que le tableau de bord (jours locaux se terminant aujourd'hui, minuit local
 * de demain exclu) ; « Tout » n'a pas de borne. Pur calendrier : aucune statistique ici.
 */
export function periodRange(period: PeriodKey, nowMs: number, tzOffsetMin: number): { from: number | null; to: number | null } {
  const days = PERIOD_DAYS[period]
  if (days === null) return { from: null, to: null }
  const today = Math.floor((nowMs + tzOffsetMin * 60_000) / DAY_MS)
  const midnight = (day: number) => day * DAY_MS - tzOffsetMin * 60_000
  return { from: midnight(today + 1 - days), to: midnight(today + 1) }
}
