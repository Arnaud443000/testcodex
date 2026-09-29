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

/** Filtres communs des rapports (StatsQuery de pulse-core) : trades clôturés dans `[from, to)`. */
export interface StatsQuery {
  /** Tous les comptes si vide ; ils doivent partager une devise. */
  accountIds?: number[]
  from?: number | null
  to?: number | null
  direction?: Direction | null
  instrumentIds?: number[]
  /** Trades portant tous ces tags. */
  tagIds?: number[]
  riskFreeDaily?: number
}

export interface Segment {
  /** Clé stable (id de tag, « long », « yes », « first »…) ; « none » = sans valeur, toujours en dernier. */
  key: string
  /** Libellé technique (nom du tag ou texte de la règle) ; l'interface traduit les clés fixes. */
  label: string
  summary: Summary
}

/** Distribution des R-multiples (3.3.8) : classes `[from, to)` de 0,5 R, deux classes ouvertes aux extrémités. */
export interface RBin {
  from: number | null
  to: number | null
  count: number
}

export interface RDistribution {
  binWidth: number
  bins: RBin[]
  rTradeCount: number
  noRCount: number
  meanR: number | null
  medianR: number | null
}

/** Case de la heatmap jour de semaine × heure locale d'entrée. */
export interface HeatCell {
  /** 1 = lundi … 7 = dimanche. */
  weekday: number
  hour: number
  tradeCount: number
  winCount: number
  netPnl: Decimal
  winRate: number | null
  /** Entre −1 et 1. */
  intensity: number
}

export interface Heatmap {
  cells: HeatCell[]
  maxAbsNetPnl: Decimal
}

export interface LongShort {
  long: Summary
  short: Summary
  longShare: number | null
}

export interface TradeRisk {
  tradeId: number
  entryTime: number
  exitTime: number
  initialRisk: Decimal | null
  balanceAtEntry: Decimal
  /** Fraction (0,01 = 1 %). */
  riskPct: number | null
  withinLimit: boolean | null
}

/** Risque en % du solde réel du compte à l'entrée (3.3.12). */
export interface RiskReport {
  trades: TradeRisk[]
  tradeCount: number
  withoutStopCount: number
  avgRiskPct: number | null
  medianRiskPct: number | null
  maxRiskPct: number | null
  /** Limite de l'utilisateur, en pourcentage (« 1.5 » = 1,5 %). */
  maxRiskPercent: Decimal | null
  overLimitCount: number | null
  currentCapital: Decimal
  limitAmount: Decimal | null
}
