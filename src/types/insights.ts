import type { Decimal } from './money'
import type { Summary } from './stats'
import type { Comparison as FactorComparison, FactorKey, MistakeSource } from './behavior'

/**
 * Insights automatiques (lot 19, cahier 3.5.1 à 3.5.3) : miroir exact de `pulse_core::insights`.
 * Chaque insight est un gabarit : `messageKey` (clé de `fr.insights.messages`) + valeurs calculées par pulse-core.
 * Voir CLAUDE.md, « Insights automatiques (lot 19) ».
 */

export type InsightPriority = 'high' | 'medium' | 'low'
export type InsightCategory = 'trend' | 'suggestion' | 'highlight'
export type Drift = 'up' | 'down'
export type InsightSource =
  | 'risk'
  | 'discipline'
  | 'fees'
  | 'ruleAdherence'
  | 'sizeChange'
  | 'patterns'
  | 'segments'
  | 'mistakes'
  | 'emotions'
  | 'externalFactors'

export type InsightMessageKey =
  | 'riskDrift.up'
  | 'riskDrift.down'
  | 'disciplineTrend.down'
  | 'disciplineTrend.up'
  | 'planDrop'
  | 'ruleAdherenceDrop'
  | 'feesUp'
  | 'sizeUpAfterLoss'
  | 'revengePattern'
  | 'overtradingPattern'
  | 'costlyMistake.tag'
  | 'costlyMistake.rule'
  | 'emotionLower'
  | 'factorLower'
  | 'bestSegment.setup'
  | 'bestSegment.session'
  | 'weakSegment.setup'
  | 'weakSegment.session'

/** Filtre de la liste des trades qui montre les trades en cause. */
export type EvidenceFilter = { kind: 'mistake'; source: MistakeSource; id: number } | { kind: 'setup'; tagId: number }

export interface InsightPeriod {
  /** `lastTrades` : les derniers trades clôturés ; `days` : les 90 derniers jours locaux. */
  basis: 'lastTrades' | 'days'
  from: number | null
  to: number | null
  tradeCount: number
  days: number | null
}

/** Une moitié de la fenêtre de tendance. */
export interface InsightHalf {
  tradeCount: number
  valueCount: number
  from: number
  to: number
  tradeIds: number[]
}

export interface SegmentHighlight {
  dimension: 'setup' | 'session'
  tagId: number
  name: string
  summary: Summary
  baselineExpectancyR: number
  baselineRTradeCount: number
  eligibleCount: number
  gap: number
  minRTrades: number
}

export type InsightDetail =
  | {
      kind: 'riskDrift'
      direction: Drift
      older: InsightHalf
      recent: InsightHalf
      olderAvgRiskPct: number
      recentAvgRiskPct: number
      change: number
      olderAvgRisk: Decimal
      recentAvgRisk: Decimal
      riskChange: number | null
      threshold: number
    }
  | { kind: 'disciplineTrend'; direction: Drift; older: InsightHalf; recent: InsightHalf; olderScore: number; recentScore: number; difference: number; threshold: number }
  | { kind: 'planDrop'; older: InsightHalf; recent: InsightHalf; olderRate: number; recentRate: number; difference: number; threshold: number }
  | { kind: 'ruleAdherenceDrop'; ruleId: number; text: string; checks: number; respected: number; rate: number | null; trend: number; threshold: number; minChecks: number }
  | { kind: 'feesUp'; older: InsightHalf; recent: InsightHalf; olderAvgFees: Decimal; recentAvgFees: Decimal; change: number; threshold: number }
  | {
      kind: 'sizeUpAfterLoss'
      afterLossMean: number
      afterLossMedian: number | null
      afterWinMean: number
      lossVsWin: number
      afterLossCases: number
      afterWinCases: number
      increasedCount: number
      threshold: number
    }
  | { kind: 'revengePattern'; count: number; netPnl: Decimal; winRate: number | null; windowMin: number; sizeFactor: Decimal; minCount: number }
  | { kind: 'overtradingPattern'; dayCount: number; limit: number; days: string[]; tradeCount: number; minCount: number }
  | {
      kind: 'costlyMistake'
      /** `mistake…` : `id` et `source` désignent déjà l'insight et son rapport. */
      mistakeSource: MistakeSource
      mistakeId: number
      label: string
      tradeCount: number
      shareOfTrades: number | null
      cost: Decimal
      totalLosses: Decimal
      shareOfLosses: number | null
      netPnl: Decimal
      expectancyR: number | null
      minTrades: number
      minShareOfLosses: number
    }
  | { kind: 'emotionLower'; tagId: number; name: string; group: Summary; others: Summary; difference: number; threshold: number }
  | {
      kind: 'factorLower'
      factor: FactorKey
      presentDays: number
      absentDays: number
      presentTradeCount: number
      absentTradeCount: number
      discipline: FactorComparison
      expectancyR: FactorComparison
    }
  | ({ kind: 'bestSegment' } & SegmentHighlight)
  | ({ kind: 'weakSegment' } & SegmentHighlight)

export type InsightKind = InsightDetail['kind']

export type Insight = InsightDetail & {
  /** `situation:palier#épisode` : un insight masqué ne revient jamais sous cet identifiant. */
  id: string
  situation: string
  level: number
  episode: number
  accountId: number
  currency: string | null
  category: InsightCategory
  priority: InsightPriority
  messageKey: InsightMessageKey
  period: InsightPeriod
  source: InsightSource
  tradeIds: number[]
  filter: EvidenceFilter | null
  firstSeenAt: number | null
  dismissedAt: number | null
}

/** Une ligne de l'historique des insights. */
export interface InsightRecord {
  insightId: string
  accountId: number
  situation: string
  level: number
  episode: number
  kind: string
  category: InsightCategory
  priority: InsightPriority
  firstSeenAt: number
  lastSeenAt: number
  dismissedAt: number | null
  /** L'insight tel qu'il a été montré la première fois. */
  insight: Insight
}
