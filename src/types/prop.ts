import type { Decimal } from './money'

/**
 * Suivi d'un compte prop firm (lot 33) : miroir de `crates/pulse-core/src/prop/`.
 * Tout vient des trades CLÔTURÉS (la perte latente des positions ouvertes est inconnue de Pulse).
 * Définitions : CLAUDE.md, « Suivi prop firm (lot 33) ». L'interface ne calcule rien.
 */

export type LimitMode = 'percent' | 'amount'
export type DailyReference = 'initialBalance' | 'dayStartBalance'
export type MaxLossKind = 'static' | 'trailing'
export type ResetZone = 'paris' | 'newYork'

/** ok (< 70 % utilisé) · attention (≥ 70 %) · critique (≥ 90 %) · atteinte (≥ 100 %, égalité comprise). */
export type PropLevel = 'ok' | 'warning' | 'critical' | 'reached'

export interface PropLimit {
  mode: LimitMode
  /** Pourcentage (« 5 » = 5 %) ou montant dans la devise du compte. */
  value: Decimal
}

export interface PropRules {
  accountId: number
  /** Texte libre (« Évaluation 1 », « Financé »…), sans effet sur les calculs. */
  phaseLabel: string | null
  /** « AAAA-MM-JJ » : les trades clôturés avant 00:00 de ce jour (zone de remise à zéro) ne comptent pas. */
  startedOn: string
  dailyLoss: PropLimit | null
  dailyReference: DailyReference
  maxLoss: PropLimit | null
  maxLossKind: MaxLossKind
  trailingLocksAtInitial: boolean
  /** « HH:MM » dans `resetZone`. */
  resetTime: string
  resetZone: ResetZone
  profitTarget: PropLimit | null
  minTradingDays: number | null
  consistencyMaxBestDayPercent: Decimal | null
}

/** Saisie de l'éditeur : chaînes contrôlées (et refusées au besoin) par pulse-core, qui fait foi. */
export interface PropLimitInput {
  mode: string
  value: string
}
export interface PropRulesInput {
  phaseLabel: string | null
  startedOn: string
  dailyLoss: PropLimitInput | null
  dailyReference: string
  maxLoss: PropLimitInput | null
  maxLossKind: string
  trailingLocksAtInitial: boolean
  resetTime: string
  resetZone: string
  profitTarget: PropLimitInput | null
  minTradingDays: number | null
  consistencyMaxBestDayPercent: string | null
}

export interface TradingDay {
  /** Date locale (zone de remise à zéro) à laquelle il commence. */
  key: string
  startsAt: number
  endsAt: number
  startsParisDay: string
  startsParisTime: string
  endsParisDay: string
  endsParisTime: string
}

export interface DailyLossStatus {
  rule: PropLimit
  reference: DailyReference
  referenceBalance: Decimal
  /** En argent ; `null` si un pourcentage d'une référence ≤ 0 ne donne aucune limite. */
  limit: Decimal | null
  dayNetPnl: Decimal
  loss: Decimal
  remaining: Decimal | null
  used: number | null
  level: PropLevel | null
  tradeCount: number
}

export interface MaxLossStatus {
  rule: PropLimit
  kind: MaxLossKind
  locksAtInitial: boolean
  limit: Decimal | null
  peak: Decimal
  floor: Decimal | null
  floorLocked: boolean
  remaining: Decimal | null
  used: number | null
  level: PropLevel | null
}

export interface ProfitTargetStatus {
  rule: PropLimit
  target: Decimal | null
  gain: Decimal
  remaining: Decimal | null
  progress: number | null
  reached: boolean | null
}

export interface TradingDaysStatus {
  count: number
  minimum: number | null
  missing: number | null
  done: boolean | null
}

export interface DayPnl {
  day: TradingDay
  netPnl: Decimal
  tradeCount: number
}

export interface ConsistencyStatus {
  maxBestDayPercent: Decimal
  totalProfit: Decimal
  bestDay: DayPnl | null
  share: number | null
  bestDayAllowed: Decimal | null
  violated: boolean | null
  used: number | null
  level: PropLevel | null
}

export interface NextReset {
  at: number
  inMs: number
  parisDay: string
  parisTime: string
}

export interface PropStatus {
  accountId: number
  currency: string
  rules: PropRules
  /** Seuils des niveaux, lus par l'interface (jamais écrits en dur). */
  thresholds: { warningPercent: number; criticalPercent: number }
  now: number
  startedAt: number
  initialCapital: Decimal
  balance: Decimal
  netPnl: Decimal
  closedTradeCount: number
  beforeStartCount: number
  openTradeCount: number
  cashFlowCount: number
  lastTradeId: number | null
  lastExitAt: number | null
  tradingDay: TradingDay
  nextReset: NextReset
  dailyLoss: DailyLossStatus | null
  maxLoss: MaxLossStatus | null
  profitTarget: ProfitTargetStatus | null
  tradingDays: TradingDaysStatus
  consistency: ConsistencyStatus | null
  alertsEnabled: boolean
}

/** Détail commun aux trois alertes prop (lot 33). */
export interface PropAlertDetail {
  level: PropLevel
  currency: string
  phaseLabel: string | null
  used: number | null
  remaining: Decimal | null
  limit: Decimal | null
  tradingDay: string | null
  nextResetParisDay: string | null
  nextResetParisTime: string | null
  share: number | null
  maxBestDayPercent: Decimal | null
}
