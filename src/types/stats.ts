import type { Decimal } from './money'
import type { Direction, Outcome } from './trade'

/** Formes renvoyées par pulse-core (crates/pulse-core/src/stats). Les ratios sont des fractions (0,58 = 58 %). */

export type PeriodKey = '1D' | '1W' | '1M' | '3M' | '1Y' | 'ALL'
export type EnginePeriod = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'all'

export interface Summary {
  tradeCount: number
  winCount: number
  lossCount: number
  breakevenCount: number
  grossPnl: Decimal
  fees: Decimal
  netPnl: Decimal
  totalGains: Decimal
  totalLosses: Decimal
  returnPct: number | null
  winRate: number | null
  avgWin: Decimal | null
  avgLoss: Decimal | null
  avgWinLossRatio: number | null
  profitFactor: number | null
  expectancyR: number | null
  rTradeCount: number
  avgNetPnl: Decimal | null
  sharpe: number | null
  maxDrawdown: Decimal
  maxDrawdownPct: number | null
  currentDrawdown: Decimal
  currentDrawdownPct: number | null
}

export interface EquityPoint {
  tradeId: number
  time: number
  cumulativeNetPnl: Decimal
  growth: number | null
  drawdown: Decimal
  drawdownPct: number | null
}

export interface DayResult {
  day: string
  netPnl: Decimal
  tradeCount: number
  winCount: number
  lossCount: number
}

export interface Report {
  currency: string | null
  initialCapital: Decimal
  totalDeposits: Decimal
  totalWithdrawals: Decimal
  currentCapital: Decimal
  openTradeCount: number
  summary: Summary
  equityCurve: EquityPoint[]
  daily: DayResult[]
}

export interface Comparison {
  tradeCount: number
  netPnl: Decimal
  netPnlPct: number | null
  winRate: number | null
  profitFactor: number | null
  avgWinLossRatio: number | null
  expectancyR: number | null
  maxDrawdown: Decimal
}

export interface Sparklines {
  netPnl: (number | null)[]
  winRate: (number | null)[]
  profitFactor: (number | null)[]
  avgWinLossRatio: (number | null)[]
  expectancyR: (number | null)[]
  maxDrawdown: (number | null)[]
}

export interface Dashboard {
  report: Report
  from: number | null
  to: number | null
  previousFrom: number | null
  previousTo: number | null
  previous: Summary | null
  comparison: Comparison | null
  sparklines: Sparklines
}

export interface DashboardQuery {
  accountIds: number[]
  period: EnginePeriod
  nowMs: number
  tzOffsetMin: number
}

export interface CalendarDay extends DayResult {
  dayOfMonth: number
  /** Résultat du jour rapporté au plus gros jour du mois, entre −1 et 1. */
  intensity: number
}

export interface Calendar {
  year: number
  month: number
  daysInMonth: number
  /** 1 = lundi … 7 = dimanche. */
  firstWeekday: number
  currency: string | null
  days: CalendarDay[]
  summary: Summary
}

export interface CalendarQuery {
  accountIds: number[]
  year: number
  month: number
  tzOffsetMin: number
}

export interface DayTrade {
  tradeId: number
  symbol: string
  direction: Direction
  exitTime: number
  netPnl: Decimal
  rMultiple: number | null
  outcome: Outcome
}
