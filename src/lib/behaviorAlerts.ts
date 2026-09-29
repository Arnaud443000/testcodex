import type { PatternReport } from '../types/behavior'

export interface BehaviorAlert {
  /** `critical` : le schéma se produit aujourd'hui ; `warning` : présent sur la période. */
  level: 'critical' | 'warning'
  key: 'overtrading' | 'revenge'
  count: number
  /** Limite de trades par jour (surtrading uniquement). */
  limit: number | null
}

const localDay = (ms: number, tzOffsetMin: number) => new Date(ms + tzOffsetMin * 60_000).toISOString().slice(0, 10)

/**
 * Bandeau d'alerte : ne fait que lire les détections de pulse-core (surtrading, revanche) et
 * décider de l'urgence selon que la date est aujourd'hui. Aucun seuil ici : ceux de l'utilisateur
 * (limite par jour, fenêtre de revanche) sont appliqués par le moteur. Les alertes à seuils
 * configurables (série de pertes, etc.) sont prévues à l'étape 3.
 */
export function buildAlerts(patterns: PatternReport, nowMs: number, tzOffsetMin: number): BehaviorAlert[] {
  const today = localDay(nowMs, tzOffsetMin)
  const alerts: BehaviorAlert[] = []
  const limit = patterns.maxTradesPerDay
  if (patterns.overtradingDays.length > 0) {
    const todays = patterns.overtradingDays.filter((d) => d.day === today)
    alerts.push(
      todays.length > 0
        ? { level: 'critical', key: 'overtrading', count: Math.max(...todays.map((d) => d.tradeCount)), limit }
        : { level: 'warning', key: 'overtrading', count: patterns.overtradingDays.length, limit },
    )
  }
  if (patterns.revengeTrades.length > 0) {
    const todays = patterns.revengeTrades.filter((r) => localDay(r.exitTime, tzOffsetMin) === today)
    alerts.push(
      todays.length > 0
        ? { level: 'critical', key: 'revenge', count: todays.length, limit: null }
        : { level: 'warning', key: 'revenge', count: patterns.revengeTrades.length, limit: null },
    )
  }
  return alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'critical' ? -1 : 1))
}
