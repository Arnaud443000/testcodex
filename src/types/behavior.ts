import type { Decimal } from './money'
import type { Outcome, PlanFollowed, TagKind } from './trade'
import type { Segment, Summary } from './stats'

/**
 * Formes renvoyées par l'analyse comportementale de pulse-core (crates/pulse-core/src/behavior).
 * Les formules sont décrites dans CLAUDE.md, « Analyse comportementale (lot 8) ».
 * Les ratios sont des fractions (0,25 = 25 %), les scores vont de 0 à 100, l'argent est une chaîne décimale.
 */

/** Seuils de l'analyse (table `settings`). */
export interface BehaviorSettings {
  /** Risque max par trade en % du solde (« 1.5 » = 1,5 %) ; null = pas de limite. */
  maxRiskPercent: Decimal | null
  /** Trades max entrés par jour ; null = pas de détection de surtrading. */
  maxTradesPerDay: number | null
  revengeWindowMin: number
  revengeSizeFactor: Decimal
}

export type ComponentKey = 'plan' | 'rules' | 'checklist' | 'stopLoss' | 'risk' | 'behavior'

export interface Component {
  key: ComponentKey
  weight: number
  /** De 0 à 1 ; null = pas de donnée, composante exclue du score. */
  value: number | null
}

export type ExposureBasis = 'risk' | 'size'

export interface Revenge {
  previousTradeId: number
  gapMs: number
  basis: ExposureBasis
  ratio: number | null
}

export interface TradeDiscipline {
  tradeId: number
  accountId: number
  entryTime: number
  exitTime: number | null
  /** Jour local de sortie « AAAA-MM-JJ ». */
  day: string | null
  netPnl: Decimal | null
  outcome: Outcome | null
  score: number | null
  /** Part des poids ayant une donnée, de 0 à 1. */
  coverage: number
  components: Component[]
  planFollowed: PlanFollowed | null
  rulesChecked: number
  rulesRespected: number
  checklistTotal: number
  checklistChecked: number
  hasStopLoss: boolean
  riskPct: number | null
  maxRiskPercent: Decimal | null
  revenge: Revenge | null
  overtrading: boolean
  dayRank: number
}

export interface ComponentSummary {
  key: ComponentKey
  weight: number
  tradeCount: number
  average: number | null
}

export interface DayDiscipline {
  day: string
  tradeCount: number
  score: number | null
}

export interface Quadrant {
  count: number
  netPnl: Decimal
}

export interface Quadrants {
  threshold: number
  wellExecutedWins: Quadrant
  poorlyExecutedWins: Quadrant
  wellExecutedLosses: Quadrant
  poorlyExecutedLosses: Quadrant
  breakevens: Quadrant
}

export interface DisciplineReport {
  /** null sous `minTradeCount` trades. */
  score: number | null
  scoredTradeCount: number
  minTradeCount: number
  sampleTooSmall: boolean
  components: ComponentSummary[]
  days: DayDiscipline[]
  quadrants: Quadrants
  trades: TradeDiscipline[]
  settings: BehaviorSettings
}

export interface EmotionReport {
  any: Segment[]
  before: Segment[]
  during: Segment[]
  after: Segment[]
}

export interface Streak {
  outcome: Outcome
  length: number
  netPnl: Decimal
  firstTradeId: number
  lastTradeId: number
  from: number
  to: number
}

export interface StreakReport {
  current: Streak | null
  longestWin: Streak | null
  longestLoss: Streak | null
  tradeCount: number
}

/** Groupes `yes`, `partial`, `no`, `none`, toujours dans cet ordre. */
export interface PlanReport {
  groups: Segment[]
}

export interface RankGroup {
  key: string
  label: string
  summary: Summary
  disciplineScore: number | null
  scoredTradeCount: number
}

export interface FirstTradeReport {
  first: RankGroup
  subsequent: RankGroup
  /** Rangs « 1 », « 2 », « 3 », « 4+ ». */
  byRank: RankGroup[]
}

export type MistakeSource = 'tag' | 'rule'

export interface Mistake {
  source: MistakeSource
  id: number
  label: string
  tradeCount: number
  share: number | null
  netPnl: Decimal
  /** Somme des pertes, positive. */
  cost: Decimal
  expectancyR: number | null
  tradeIds: number[]
}

export interface MistakeReport {
  tradeCount: number
  tradesWithMistake: number
  byCount: Mistake[]
  byCost: Mistake[]
}

export interface MonthAdherence {
  /** « AAAA-MM ». */
  month: string
  checks: number
  respected: number
  rate: number | null
}

export interface RuleAdherence {
  ruleId: number
  text: string
  archived: boolean
  checks: number
  respected: number
  rate: number | null
  /** Écart de taux entre la moitié récente et la moitié ancienne des coches. */
  trend: number | null
  monthly: MonthAdherence[]
}

export interface RuleAdherenceReport {
  checks: number
  respected: number
  rate: number | null
  tradesWithChecks: number
  rules: RuleAdherence[]
}

export interface RevengeTrade extends Revenge {
  tradeId: number
  exitTime: number
  netPnl: Decimal
}

export interface OvertradingDay {
  accountId: number
  day: string
  tradeCount: number
  limit: number
  tradeIds: number[]
}

export interface Hesitation {
  tagId: number
  kind: TagKind
  name: string
  taken: number
  missed: number
  missedShare: number | null
}

export interface PatternReport {
  revengeTrades: RevengeTrade[]
  revengeSummary: Summary
  maxTradesPerDay: number | null
  overtradingDays: OvertradingDay[]
  hesitation: Hesitation[]
  missedTradeCount: number
}

// --- Lot 8 bis : compléments (CLAUDE.md, « Compléments du moteur ») ---
// Aucun de ces rapports n'affirme de causalité : l'interface décrit ce qui s'est passé en même temps.

/** Facteurs du journal quotidien, toujours renvoyés dans cet ordre. */
export type FactorKey = 'poorSleep' | 'highFatigue' | 'lateHours' | 'lowMood'

/** Jours avec le facteur comparés aux jours sans : `lower` = plus bas quand le facteur est présent. */
export type Verdict = 'notEnoughData' | 'lower' | 'similar' | 'higher'

export interface Comparison {
  /** null sous l'échantillon minimal de la valeur (5 trades notés, ou 5 trades avec R). */
  present: number | null
  absent: number | null
  /** présent − absent ; null quand le verdict est `notEnoughData`. */
  difference: number | null
  verdict: Verdict
}

export interface FactorSide {
  /** Jours locaux d'entrée distincts ayant au moins un trade. */
  dayCount: number
  summary: Summary
  /** null sous 5 trades notés. */
  disciplineScore: number | null
  scoredTradeCount: number
  tradeIds: number[]
}

export interface FactorReport {
  key: FactorKey
  present: FactorSide
  absent: FactorSide
  /** Jours sans journal, ou journal laissant ce facteur vide. */
  undeclaredDayCount: number
  undeclaredTradeCount: number
  /** En points. */
  discipline: Comparison
  /** En R. */
  expectancyR: Comparison
  /** PnL net moyen par trade, présent − absent, sans verdict (dépend de la taille). */
  avgNetPnlDifference: Decimal | null
}

export interface ExternalFactorReport {
  factors: FactorReport[]
  tradeCount: number
  tradingDayCount: number
  journalDayCount: number
  minDayCount: number
  minRTradeCount: number
}

export interface SequenceGroup {
  summary: Summary
  disciplineScore: number | null
  scoredTradeCount: number
  tradeIds: number[]
}

/** « Moyenne après 2 pertes » : la maquette affiche `afterTwoLosses.summary.expectancyR` (« — » si `sampleTooSmall`). */
export interface AfterLossesReport {
  afterTwoLosses: SequenceGroup
  others: SequenceGroup
  minTradeCount: number
  sampleTooSmall: boolean
  /** Écarts « après 2 pertes − autres » ; null si l'échantillon est trop petit. */
  winRateDifference: number | null
  avgNetPnlDifference: Decimal | null
  expectancyRDifference: number | null
  disciplineDifference: number | null
}

export interface SizeChangeCase {
  tradeId: number
  previousTradeId: number
  basis: ExposureBasis
  /** Exposition / exposition précédente − 1 (0,23 = +23 %). */
  change: number
}

export interface SizeChangeGroup {
  previousOutcome: Outcome
  caseCount: number
  notComparableCount: number
  increasedCount: number
  /** null sous 5 cas. */
  meanChange: number | null
  medianChange: number | null
  cases: SizeChangeCase[]
}

/** « Variation de taille après une perte » : la maquette affiche `afterLoss.meanChange`. */
export interface SizeChangeReport {
  afterLoss: SizeChangeGroup
  afterWin: SizeChangeGroup
  afterBreakeven: SizeChangeGroup
  noPreviousCount: number
  tradeCount: number
  minCaseCount: number
  /** Moyenne après perte − moyenne après gain. */
  lossVsWin: number | null
}

/** Aucun pourcentage : les soldes réels n'ont pas de sens dans une simulation. */
export interface SimulatedResult {
  tradeCount: number
  netPnl: Decimal
  winRate: number | null
  expectancyR: number | null
  rTradeCount: number
  profitFactor: number | null
  totalGains: Decimal
  totalLosses: Decimal
  maxDrawdown: Decimal
}

export interface Scenario {
  excludedTradeCount: number
  excludedNetPnl: Decimal
  result: SimulatedResult
  /** PnL net simulé − réel (positif : les trades retirés ont coûté) ; null si aucun plan n'est renseigné. */
  difference: Decimal | null
  excludedTradeIds: number[]
}

/** « Gain si le plan avait été suivi » : une simulation, à étiqueter comme telle, jamais un conseil. */
export interface PlanSimulation {
  declaredTradeCount: number
  actual: SimulatedResult
  /** Sans les trades hors plan (`no`) : c'est le chiffre de la maquette. */
  withoutOffPlan: Scenario
  /** Sans les `no` ni les `partial`. */
  withoutOffPlanOrPartial: Scenario
}
