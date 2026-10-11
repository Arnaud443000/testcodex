import type { Decimal } from './money'
import type { Direction } from './trade'

/** Miroir des types de pulse-core (`backtests.rs`). Les R sont des chaînes décimales exactes ; les statistiques, des ratios. */

export type BacktestStatus = 'running' | 'validated' | 'rejected'
export type Observation = 'past' | 'live'
export type SetupValidity = 'yes' | 'no' | 'doubtful'
export type CaseOutcome = 'tp' | 'sl' | 'manual' | 'no_entry'

/** Nombre de cas en dessous duquel un résultat est signalé « échantillon faible » (miroir de `backtests::MIN_SAMPLE`). */
export const MIN_SAMPLE = 30

export const BACKTEST_STATUSES: BacktestStatus[] = ['running', 'validated', 'rejected']
export const OBSERVATIONS: Observation[] = ['past', 'live']
export const VALIDITIES: SetupValidity[] = ['yes', 'no', 'doubtful']
export const OUTCOMES: CaseOutcome[] = ['tp', 'sl', 'manual', 'no_entry']

export interface BacktestData {
  name: string
  asset: string
  timeframe: string
  /** Conditions d'entrée, texte libre (une par ligne). */
  entryConditions: string
  exitRules: string
  notes: string
  status: BacktestStatus
  /** Tag « setup » lié, pour comparer avec les vrais trades. */
  setupTagId: number | null
}

export interface Backtest extends BacktestData {
  id: number
}

export interface CaseData {
  /** Millisecondes Unix, UTC. */
  occurredAt: number
  tzOffsetMin: number
  direction: Direction | null
  observation: Observation
  setupValid: SetupValidity
  outcome: CaseOutcome
  plannedRr: Decimal | null
  /** R obtenu (−1 = stoppé). Obligatoire sauf « entrée non déclenchée ». */
  resultR: Decimal | null
  /** Plus grand mouvement favorable en R, avant le stop ou la fin du trade. */
  maxR: Decimal | null
  notes: string
}

export interface BacktestCase extends CaseData {
  id: number
  backtestId: number
}

export interface Validity {
  yes: number
  no: number
  doubtful: number
  rate: number | null
}

export interface PerfSummary {
  tradeCount: number
  winCount: number
  lossCount: number
  breakevenCount: number
  winRate: number | null
  expectancyR: number | null
  totalR: number
  avgWinR: number | null
  avgLossR: number | null
  profitFactor: number | null
  avgPlannedRr: number | null
  avgMaxR: number | null
  maxDrawdownR: number
  lowSample: boolean
}

export interface BacktestCurvePoint {
  caseId: number
  occurredAt: number
  resultR: number
  cumulativeR: number
}

export interface Scenario {
  tpR: number
  reachedCount: number
  winRate: number | null
  expectancyR: number | null
  totalR: number
  differenceR: number
}

export interface TpScenarios {
  sampleCount: number
  missingMaxRCount: number
  lowSample: boolean
  actualTotalR: number
  actualExpectancyR: number | null
  actualWinRate: number | null
  levels: Scenario[]
  bestTpR: number | null
}

export interface RealComparison {
  tagId: number
  tradeCount: number
  winRate: number | null
  expectancyR: number | null
  rTradeCount: number
}

export interface BacktestReport {
  backtestId: number
  caseCount: number
  validity: Validity
  noEntryCount: number
  overall: PerfSummary
  past: PerfSummary
  live: PerfSummary
  long: PerfSummary
  short: PerfSummary
  curve: BacktestCurvePoint[]
  scenarios: TpScenarios
  real: RealComparison | null
}

export interface BacktestListItem extends Backtest {
  caseCount: number
  validityRate: number | null
  overall: PerfSummary
}

export interface ReportOptions {
  includeDoubtful: boolean
}
