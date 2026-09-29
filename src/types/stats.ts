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

// --- Analyses d'étape 3 (lot 14) : par actif, frais, stratégies, système / discrétionnaire ---
import type { AssetClass } from './trade'

/** Une ligne de la vue « par actif » (3.3.13). `summary.expectancyR` est le R moyen. */
export interface AssetRow {
  instrumentId: number
  symbol: string
  assetClass: AssetClass
  summary: Summary
  /** frais / PnL brut ; null si le brut n'est pas positif. */
  feesShareOfGross: number | null
  /** Moins de 5 trades clôturés : à afficher avec un avertissement. */
  lowSample: boolean
}

export type FeeGranularity = 'day' | 'week' | 'month'

export interface FeePoint {
  tradeId: number
  time: number
  cumulativeFees: Decimal
  cumulativeGrossPnl: Decimal
  cumulativeNetPnl: Decimal
}

export interface FeePeriod {
  /** « AAAA-MM-JJ » (jour, ou lundi de la semaine) ou « AAAA-MM » (mois). */
  key: string
  tradeCount: number
  grossPnl: Decimal
  fees: Decimal
  netPnl: Decimal
  feesShareOfGross: number | null
  cumulativeFees: Decimal
}

/** Frais et commissions (3.3.15) : positif = coût, négatif = crédit. */
export interface FeeReport {
  tradeCount: number
  tradesWithFees: number
  grossPnl: Decimal
  fees: Decimal
  netPnl: Decimal
  feesShareOfGross: number | null
  feesPerTrade: Decimal | null
  curve: FeePoint[]
  periods: FeePeriod[]
}

export interface StrategyPoint {
  tradeId: number
  time: number
  cumulativeNetPnl: Decimal
}

/** Une stratégie = un tag « setup » (3.3.16). `tagId` est null pour les trades sans setup. */
export interface StrategyRow {
  tagId: number | null
  name: string
  summary: Summary
  shareOfTrades: number | null
  lowSample: boolean
  curve: StrategyPoint[]
}

export interface ExecutionBlock {
  summary: Summary
  lowSample: boolean
}

/** Système contre discrétionnaire (3.3.17), d'après le champ `executionType` du trade. */
export interface ExecutionReport {
  system: ExecutionBlock
  discretionary: ExecutionBlock
  /** Type jamais renseigné : jamais deviné, jamais compté dans les écarts. */
  unclassified: ExecutionBlock
  /** Trades clôturés qu'il faut de chaque côté avant de chiffrer un écart. */
  minSample: number
  comparable: boolean
  /** Système − discrétionnaire, en fraction (0,10 = +10 points). */
  winRateDelta: number | null
  expectancyRDelta: number | null
  avgNetPnlDelta: Decimal | null
}

// --- Analyses complémentaires (lot 16) ---------------------------------------------------

/** Un trade pris en compte dans le coût d'opportunité (3.3.18) : il a un TP valide et un prix après sortie. */
export interface OpportunityTrade {
  tradeId: number
  symbol: string
  direction: Direction
  exitPrice: Decimal
  plannedTp: Decimal
  priceAfterExit: Decimal
  /** (prix après − sortie) × sens × taille × multiplicateur : positif si le prix a continué dans le sens du trade. */
  moveAfterExit: Decimal
  /** Même mouvement, prix après sortie plafonné au TP prévu, jamais négatif. */
  leftOnTable: Decimal
  netPnl: Decimal
}

/** Coût d'opportunité (3.3.18) : une estimation d'après un prix saisi à la main, jamais un conseil. */
export interface OpportunityReport {
  /** Trades clôturés de la sélection. */
  tradeCount: number
  eligibleCount: number
  excludedCount: number
  /** Sans TP valide. Peut chevaucher `withoutPriceAfterCount` (un trade sans rien compte dans les deux). */
  withoutTargetCount: number
  withoutPriceAfterCount: number
  minSample: number
  lowSample: boolean
  totalLeftOnTable: Decimal
  leftCount: number
  leftPerEarlyExit: Decimal | null
  /** Trades dont le prix est allé contre eux après la sortie, et l'argent que la sortie a épargné (positif). */
  avoidedCount: number
  totalAvoided: Decimal
  netPnlOfEligible: Decimal
  trades: OpportunityTrade[]
}

export type PreviousEmptyReason = 'historyTooShort' | 'noTrades'

/** Requête de la comparaison à l'an dernier : celle du tableau de bord (comptes, période, instant et fuseau). */
export interface YearComparisonQuery {
  accountIds: number[]
  period: EnginePeriod
  nowMs: number
  tzOffsetMin: number
}

/** Même période un an plus tôt (3.3.19). `comparison` est absent quand l'an dernier est vide : jamais d'écart contre du vide. */
export interface YearComparison {
  /** Faux pour « Tout » : rien ne le précède. */
  available: boolean
  from: number | null
  to: number | null
  previousFrom: number | null
  previousTo: number | null
  minSample: number
  current: Summary
  currentEmpty: boolean
  currentLowSample: boolean
  previous: Summary | null
  previousEmpty: boolean
  previousLowSample: boolean
  previousReason: PreviousEmptyReason | null
  comparison: Comparison | null
}

export interface DurationGroup {
  tradeCount: number
  /** Durée moyenne en millisecondes ; null pour un groupe vide. */
  avgMs: number | null
  medianMs: number | null
  lowSample: boolean
}

/** Temps en position (3.3.20) : gagnants contre perdants. Le ratio n'est chiffré qu'avec assez de trades des deux côtés. */
export interface DurationReport {
  tradeCount: number
  measuredCount: number
  /** Trades ouverts (sans heure de sortie) : exclus. */
  openTradeCount: number
  /** Sortie avant l'entrée (données incohérentes) : exclus. */
  invalidCount: number
  minSample: number
  winners: DurationGroup
  losers: DurationGroup
  breakevens: DurationGroup
  comparable: boolean
  /** Durée moyenne des gagnants / durée moyenne des perdants. */
  avgRatio: number | null
  medianRatio: number | null
}

export type ScalingVerdict = 'notEnoughData' | 'undersized' | 'stable' | 'oversized'

export interface ScalingPoint {
  tradeId: number
  exitTime: number
  balanceAtEntry: Decimal
  initialRisk: Decimal
  /** Risque initial / solde à l'entrée (0,01 = 1 %). */
  riskPct: number
}

export interface ScalingHalf {
  tradeCount: number
  avgBalance: Decimal
  avgRisk: Decimal
  avgRiskPct: number
  /** Instants de sortie du premier et du dernier trade de la moitié. */
  from: number
  to: number
}

/** Scaling du capital (3.3.21) : le risque pris suit-il le capital ? Un constat, jamais un ordre. */
export interface ScalingReport {
  tradeCount: number
  usableCount: number
  excludedCount: number
  withoutStopCount: number
  /** Seuils du moteur : l'interface les affiche sans les écrire en dur. */
  minPerHalf: number
  capitalMoveThreshold: number
  verdictBand: number
  currentCapital: Decimal
  points: ScalingPoint[]
  older: ScalingHalf | null
  recent: ScalingHalf | null
  capitalChange: number | null
  riskChange: number | null
  /** Variation relative du risque moyen en % du solde, dont le verdict découle. */
  riskPctChange: number | null
  capitalMoved: boolean
  verdict: ScalingVerdict
}
// --- Comparaisons et exposition (lot 17) ---

/** Une ligne de la comparaison entre comptes (3.7.6) : un compte, calculé seul. */
export interface AccountRow {
  accountId: number
  name: string
  broker: string
  currency: string
  summary: Summary
  /** Frais / trades clôturés (positif = coût) ; null sans trade. */
  feesPerTrade: Decimal | null
  /** frais / PnL brut ; null si le brut n'est pas positif. */
  feesShareOfGross: number | null
  /** Moins de `minSample` trades clôturés : affiché, jamais utilisé pour une piste. */
  lowSample: boolean
}

/** `fees` : le compte paie une plus grande part de son brut en frais que l'autre. `execution` : son R moyen est plus bas. */
export type AccountHintKind = 'fees' | 'execution'

/** Une piste à vérifier, jamais une conclusion. */
export interface AccountHint {
  kind: AccountHintKind
  accountId: number
  otherAccountId: number
  /** Frais : écart de part (0,10 = 10 points). Exécution : écart de R moyen. */
  gap: number
  /** Instruments clôturés sur les deux comptes. */
  sharedInstruments: number
}

export interface AccountComparison {
  rows: AccountRow[]
  currencies: string[]
  /** Plus d'une devise : aucun montant ne se somme ni ne se compare. */
  mixedCurrencies: boolean
  minSample: number
  feesGapThreshold: number
  rGapThreshold: number
  hints: AccountHint[]
}

/** Un trade au-dessus de la limite de risque (3.4.11). */
export interface RiskViolation {
  tradeId: number
  accountId: number
  symbol: string
  direction: Direction
  exitTime: number
  initialRisk: Decimal
  balanceAtEntry: Decimal
  /** Risque / solde à l'entrée (0,015 = 1,5 %). */
  riskPct: number
  /** La limite en argent au solde à l'entrée. */
  limitAmount: Decimal
  /** riskPct − limite, en fraction (0,005 = un demi-point au-dessus). */
  excessPct: number
  /** riskPct / limite (1,5 = 50 % au-dessus). */
  overFactor: number
}

export interface RiskMonth {
  /** AAAA-MM, mois local de sortie. */
  key: string
  evaluatedCount: number
  overCount: number
  complianceRate: number | null
}

export type ComplianceTrend = 'notEnoughData' | 'improving' | 'stable' | 'worsening'

export interface RiskBenchmark {
  /** Limite de l'utilisateur en pourcentage ; null = aucune limite réglée, rien n'est évalué. */
  limitPercent: Decimal | null
  tradeCount: number
  evaluatedCount: number
  withoutStopCount: number
  respectedCount: number
  overCount: number
  complianceRate: number | null
  avgRiskPct: number | null
  maxRiskPct: number | null
  trend: ComplianceTrend
  olderRate: number | null
  recentRate: number | null
  minTrendTrades: number
  months: RiskMonth[]
  points: TradeRisk[]
  /** Du plus récent au plus ancien. */
  violations: RiskViolation[]
}

/** Exposition d'une catégorie d'actif (3.7.9). */
export interface ExposureRow {
  assetClass: AssetClass
  tradeCount: number
  /** Trades avec un stop valide, donc un risque connu. */
  riskTradeCount: number
  withoutStopCount: number
  riskAmount: Decimal
  /** Part du risque total (en argent) ; null si le risque de la catégorie ou le total est inconnu / nul. */
  shareOfRisk: number | null
  /** Somme des risques par trade, en % du solde à l'entrée (0,035 = 3,5 %). */
  riskPctOfCapital: number | null
  avgRiskPct: number | null
}

export interface ExposureReport {
  currency: string | null
  tradeCount: number
  withoutStopCount: number
  totalRisk: Decimal
  totalRiskPct: number | null
  rows: ExposureRow[]
}
