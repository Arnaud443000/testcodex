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
