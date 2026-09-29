import type { Decimal } from './money'
import type { Direction, Outcome } from './trade'

/** Miroir des types de pulse-core (missed_trades, journal, execution_quality, confidence, reminder, period). */

export interface MissedTradeData {
  accountId: number
  instrumentId: number
  direction?: Direction | null
  /** Millisecondes Unix, UTC. */
  occurredAt: number
  tzOffsetMin: number
  /** Pourquoi le trade n'a pas été pris (peur, doute…). */
  reason: string
  notes: string
  /** Conviction dans le setup, 1 à 10. */
  conviction?: number | null
  tagIds: number[]
}

export interface MissedTrade extends MissedTradeData {
  id: number
}

/** Une entrée par jour local (« AAAA-MM-JJ »). Un journal entièrement vide est supprimé au lieu d'être enregistré. */
export interface JournalEntry {
  day: string
  /** Humeur générale, 1 (mauvaise) à 5 (excellente). */
  mood?: number | null
  /** Qualité du sommeil de la nuit précédente, 1 à 5. */
  sleepQuality?: number | null
  /** Fatigue dans la journée, 1 (aucune) à 5 (épuisé). */
  fatigue?: number | null
  lateHours: boolean
  wentWell: string
  toImprove: string
  notes: string
}

export interface DayTradeLine {
  tradeId: number
  symbol: string
  direction: Direction
  currency: string
  entryTime: number
  /** null tant que le trade est ouvert. */
  netPnl: Decimal | null
  outcome: Outcome | null
  /** Trade de la saisie rapide dont la thèse ou les émotions manquent. */
  incomplete: boolean
}

export interface DayOverview {
  day: string
  entry: JournalEntry | null
  trades: DayTradeLine[]
  incompleteCount: number
}

/** Comptes (tous si vide) et fenêtre de sortie `[from, to)` en millisecondes UTC. */
export interface PeriodQuery {
  accountIds?: number[]
  from?: number | null
  to?: number | null
}

export type Grade = 'good' | 'poor'

export interface ExecutionScore {
  components: { checklist: number | null; plan: number | null; rules: number | null }
  /** Moyenne des composantes disponibles, 0 à 100. */
  autoScore: number | null
  /** Note saisie à la main (1 à 5) : elle l'emporte sur le score automatique. */
  manual: number | null
  score: number | null
  source: 'manual' | 'auto' | null
  /** Le score sur l'échelle 1 à 5 des barres. */
  stars: number | null
  grade: Grade | null
}

export interface Quadrant {
  outcome: Outcome
  grade: Grade
  tradeCount: number
  netPnl: Decimal
}

export interface QualityReport {
  currency: string | null
  tradeCount: number
  scoredCount: number
  unscoredCount: number
  averageScore: number | null
  averageStars: number | null
  /** Toujours quatre cases : gain·bien, gain·mal, perte·bien, perte·mal. */
  quadrants: Quadrant[]
  breakevenCount: number
}

export type ConvictionBucket = 'low' | 'medium' | 'high'
export type ConfidenceVerdict = 'not_enough_data' | 'predictive' | 'not_predictive' | 'inverse'

export interface BucketStats {
  bucket: ConvictionBucket
  min: number
  max: number
  tradeCount: number
  winCount: number
  winRate: number | null
  avgNetPnl: Decimal | null
  avgR: number | null
  rTradeCount: number
}

export interface MissedComparison {
  missedCount: number
  missedWithConviction: number
  missedAvgConviction: number | null
  takenAvgConviction: number | null
  missedHighConviction: number
}

export interface ConfidenceReport {
  currency: string | null
  ratedTradeCount: number
  buckets: BucketStats[]
  correlation: number | null
  correlationPairs: number
  verdict: ConfidenceVerdict
  missed: MissedComparison
}

export interface ReminderSettings {
  enabled: boolean
  /** Heure locale « HH:MM ». */
  time: string
}

export interface ReminderDue {
  day: string
  tradeCount: number
  incompleteCount: number
  journalMissing: boolean
}
