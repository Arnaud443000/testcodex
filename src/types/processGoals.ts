import type { Decimal } from './money'

/** Miroir de pulse-core::process_goals (lot 34) : objectifs de comportement, par semaine ou par mois. */
export type ProcessMetric =
  | 'no_stop_trades'
  | 'overtrading_days'
  | 'revenge_trades'
  | 'risk_breaches'
  | 'rules_respect_rate'
  | 'plan_follow_rate'
  | 'journal_days'

/** Les métriques, dans l'ordre d'affichage (celui de pulse-core). */
export const PROCESS_METRICS: ProcessMetric[] = [
  'no_stop_trades',
  'overtrading_days',
  'revenge_trades',
  'risk_breaches',
  'rules_respect_rate',
  'plan_follow_rate',
  'journal_days',
]

/** Semaine ISO locale (« AAAA-Www », lundi → dimanche) ou mois local (« AAAA-MM »). */
export type ProcessPeriodKind = 'week' | 'month'
/** Plafond (nombre d'erreurs) ou plancher (taux, jours de journal). */
export type ProcessDirection = 'atMost' | 'atLeast'
export type ProcessUnit = 'count' | 'percent'
export type RequiredSetting = 'maxTradesPerDay' | 'maxRiskPercent'
export type ProcessStatus =
  | 'respectedSoFar'
  | 'exceeded'
  | 'respected'
  | 'reached'
  | 'inProgress'
  | 'missed'
  | 'noData'
  | 'settingRequired'
export type ProcessPeriodState = 'past' | 'current' | 'future'

export interface ProcessGoal {
  id: number
  periodKind: ProcessPeriodKind
  periodKey: string
  metric: ProcessMetric
  /** Nombre entier (plafonds, jours de journal) ou pourcentage 0 < t ≤ 100 (taux). */
  target: Decimal
}

export interface NewProcessGoal {
  periodKind: ProcessPeriodKind
  periodKey: string
  metric: ProcessMetric
  target: Decimal
}

export interface ProcessProgressQuery {
  /** Comptes mesurés (tous les comptes actifs si vide) ; même devise obligatoire. */
  accountIds: number[]
  periodKind: ProcessPeriodKind
  periodKey: string
  nowMs: number
  /** Décalage UTC actuel, en minutes. */
  tzOffsetMin: number
  /** Décalage en vigueur à minuit local de certains jours (« AAAA-MM-JJ » → minutes), pour les bornes de l'autre côté d'un changement d'heure. */
  boundaryOffsets: Record<string, number>
}

export interface ProcessPeriodInfo {
  kind: ProcessPeriodKind
  key: string
  firstDay: string
  lastDay: string
  /** Fenêtre `[from, to)` des sorties comptées, en ms UTC. */
  from: number
  to: number
  state: ProcessPeriodState
  previousKey: string
  nextKey: string
}

export interface ProcessGoalProgress {
  goal: ProcessGoal
  direction: ProcessDirection
  unit: ProcessUnit
  /** Nombre, ou pourcentage 0–100 pour un taux ; `null` = pas de données ou réglage requis. */
  value: number | null
  /** Pour un taux : ce qui est compté sur quoi (règles respectées / cochées ; trades dans le plan / plan renseigné). */
  numerator: number | null
  denominator: number | null
  /** Trades clôturés de la période. */
  tradeCount: number
  status: ProcessStatus
  requiredSetting: RequiredSetting | null
  /** Périodes précédentes consécutives, terminées et réussies. */
  streak: number
  /** Trades en cause, tels que le rapport source les liste. */
  tradeIds: number[]
  /** Jours en cause (surtrading, jours de journal), « AAAA-MM-JJ ». */
  days: string[]
}

export interface ProcessProgress {
  period: ProcessPeriodInfo
  currency: string | null
  maxTradesPerDay: number | null
  maxRiskPercent: Decimal | null
  goals: ProcessGoalProgress[]
}
