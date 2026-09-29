import type { Decimal } from './money'

/** Miroir de pulse-core::goals. */
export type GoalMetric = 'net_pnl' | 'win_rate' | 'profit_factor' | 'expectancy_r' | 'execution_quality' | 'max_drawdown'
export type GoalDirection = 'at_least' | 'at_most'
export type GoalStatus = 'reached' | 'in_progress' | 'missed' | 'exceeded' | 'no_data'

/** Les métriques proposées, dans l'ordre d'affichage. */
export const GOAL_METRICS: GoalMetric[] = ['net_pnl', 'win_rate', 'profit_factor', 'expectancy_r', 'execution_quality', 'max_drawdown']

export interface Goal {
  id: number
  /** « AAAA-MM ». */
  month: string
  metric: GoalMetric
  /** Argent (P&L net, drawdown max), pourcentage 0–100 (taux de réussite), 1–5 (qualité), sinon un ratio. */
  target: Decimal
}

export interface NewGoal {
  month: string
  metric: GoalMetric
  target: Decimal
}

export interface GoalProgress {
  goal: Goal
  direction: GoalDirection
  tradeCount: number
  currency: string | null
  /** Valeur atteinte d'une métrique en argent. */
  actualMoney: Decimal | null
  /** Valeur atteinte des autres métriques (taux de réussite en %). Absente pour un profit factor sans aucune perte. */
  actualRatio: number | null
  /** Atteint / cible (≥ 0) ; au-dessus de 1 : cible dépassée, ou plafond franchi. */
  fraction: number | null
  status: GoalStatus
}

export interface ProgressQuery {
  accountIds: number[]
  month: string
  tzOffsetMin: number
  /** Jour local « AAAA-MM-JJ » : indique si le mois est terminé. */
  today: string
}
