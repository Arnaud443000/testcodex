import type { Messages } from '../i18n'
import type { Comparison } from '../types/behavior'
import type { Decimal } from '../types/money'
import type { Insight, InsightCategory, InsightSource } from '../types/insights'
import { formatScore, formatSizeChange } from './behaviorFormat'
import { formatDate, formatMoney, formatNumber, formatPoints, formatR, formatRatioPercent, formatSignedMoney, formatSignedRatioPercent } from './format'
import { mistakeLink } from './mistakeFilter'

/**
 * Affichage des insights (lot 19 bis). Aucun calcul métier : les valeurs viennent toutes de pulse-core, on les met en
 * forme (fractions → pourcentages, décimaux exacts → montants sans flottant, R avec vrai signe moins) et on les range.
 * Une valeur manquante s'affiche « — », jamais 0.
 */

/**
 * En dessous de ce nombre de trades clôturés, presque aucun insight ne peut apparaître (5 valeurs par moitié de la
 * fenêtre de tendance, 10 trades avec R par segment…) : l'écran dit « pas assez de données » au lieu de « rien à
 * signaler ». Repère d'affichage seulement ; le moteur décide seul de ce qui est un insight.
 */
export const MIN_TRADES_FOR_INSIGHTS = 10

/** Ordre d'affichage des groupes (le moteur, lui, trie par priorité). */
export const CATEGORY_ORDER: InsightCategory[] = ['trend', 'highlight', 'suggestion']

/** Regroupe par catégorie dans l'ordre d'affichage, en gardant l'ordre du moteur à l'intérieur d'un groupe ; groupes vides omis. */
export function groupInsights(insights: Insight[]): { category: InsightCategory; items: Insight[] }[] {
  return CATEGORY_ORDER.map((category) => ({ category, items: insights.filter((i) => i.category === category) })).filter((g) => g.items.length > 0)
}

const currencyOf = (i: Insight): string => i.currency ?? 'USD'

/** Un écart d'expectancy « plus bas de … » est affiché en valeur absolue : « 0,42 R ». */
const absR = (gap: number): string => `${formatNumber(Math.abs(gap), 2)} R`

/** Ce que dit la comparaison d'un facteur quand son verdict est `lower`, ou `null` sinon. */
function factorPart(t: Messages, c: Comparison, kind: 'discipline' | 'expectancy'): string | null {
  if (c.verdict !== 'lower' || c.difference === null) return null
  const m = t.insights.messages
  return kind === 'discipline'
    ? m.factorDiscipline(t.insights.factorPoints(Math.round(Math.abs(c.difference))))
    : m.factorExpectancy(absR(c.difference))
}

/** La phrase d'un insight : gabarit `fr.insights.messages[messageKey]` rempli avec des valeurs formatées. */
export function insightMessage(t: Messages, i: Insight): string {
  const m = t.insights.messages
  const cur = currencyOf(i)
  switch (i.kind) {
    case 'riskDrift': {
      const args = [formatRatioPercent(i.olderAvgRiskPct, 2), formatRatioPercent(i.recentAvgRiskPct, 2), formatSignedRatioPercent(i.change, 0), i.recent.tradeCount] as const
      return (i.direction === 'up' ? m['riskDrift.up'] : m['riskDrift.down'])(...args)
    }
    case 'disciplineTrend': {
      const args = [`${formatScore(i.olderScore)}/100`, `${formatScore(i.recentScore)}/100`, i.recent.tradeCount] as const
      return (i.direction === 'down' ? m['disciplineTrend.down'] : m['disciplineTrend.up'])(...args)
    }
    case 'planDrop':
      return m.planDrop(formatRatioPercent(i.olderRate, 0), formatRatioPercent(i.recentRate, 0), i.recent.tradeCount)
    case 'ruleAdherenceDrop':
      return m.ruleAdherenceDrop(i.text, formatPoints(i.trend, 0), i.checks)
    case 'feesUp':
      return m.feesUp(formatMoney(i.olderAvgFees, cur), formatMoney(i.recentAvgFees, cur), formatSignedRatioPercent(i.change, 0), i.recent.tradeCount)
    case 'sizeUpAfterLoss':
      return m.sizeUpAfterLoss(formatSizeChange(i.afterLossMean), formatSizeChange(i.afterWinMean), i.afterLossCases)
    case 'revengePattern':
      return m.revengePattern(i.count, formatSignedMoney(i.netPnl, cur))
    case 'overtradingPattern':
      return m.overtradingPattern(i.dayCount, i.limit)
    case 'costlyMistake': {
      const fn = i.mistakeSource === 'rule' ? m['costlyMistake.rule'] : m['costlyMistake.tag']
      return fn(i.label, i.tradeCount, formatLossAmount(i.cost, cur), formatRatioPercent(i.shareOfLosses, 0))
    }
    case 'emotionLower':
      return m.emotionLower(i.name, formatR(i.group.expectancyR, 2), formatR(i.others.expectancyR, 2), i.group.tradeCount)
    case 'factorLower': {
      const factor = t.insights.factors[i.factor] ?? i.factor
      const parts = [factorPart(t, i.discipline, 'discipline'), factorPart(t, i.expectancyR, 'expectancy')].filter((p): p is string => p !== null)
      return parts.length === 0 ? t.insights.factorUnknown(factor) : m.factorLower(factor, parts.join(t.insights.factorJoin))
    }
    case 'bestSegment':
    case 'weakSegment': {
      const fn = m[`${i.kind}.${i.dimension}` as 'bestSegment.setup']
      return fn(i.name, formatR(i.summary.expectancyR, 2), i.summary.rTradeCount, formatR(i.baselineExpectancyR, 2))
    }
  }
}

/** Coût d'une erreur = somme de pertes (positive) affichée comme une perte : « −1 620,00 $ ». */
function formatLossAmount(cost: Decimal, currency: string): string {
  return /^0(\.0*)?$/.test(cost) ? formatMoney(cost, currency) : formatSignedMoney(`-${cost}`, currency)
}

/** La piste fixe (`fr.insights.suggestions`), quand il en existe une pour cette clé. */
export function insightHint(t: Messages, i: Insight): string | null {
  return t.insights.suggestions[i.messageKey] ?? null
}

/** La phrase « ce sont des constats, pas des causes » : sur les suggestions seulement. */
export function insightNotCausal(t: Messages, i: Insight): string | null {
  return i.category === 'suggestion' ? t.insights.notCausal : null
}

/** La fenêtre sur laquelle l'insight a été établi : « Sur vos 20 derniers trades (du … au …) ». */
export function insightPeriod(t: Messages, i: Insight): string {
  const p = i.period
  const base = p.basis === 'lastTrades' ? t.insights.periodLastTrades(p.tradeCount) : t.insights.periodDays(p.days ?? 90)
  return p.from !== null && p.to !== null ? `${base} · ${t.insights.periodRange(formatDate(p.from), formatDate(p.to))}` : base
}

/** Page du rapport qui a produit l'insight, selon `source`. */
export function reportLink(source: InsightSource): string {
  switch (source) {
    case 'risk':
      return '/analytics?tab=scaling'
    case 'discipline':
      return '/discipline'
    case 'fees':
      return '/analytics?tab=fees'
    case 'segments':
      return '/analytics?tab=strategies'
    default:
      return '/behavior'
  }
}

/** Trades montrés en liens directs quand l'insight n'a pas de filtre de liste (au-delà, on n'en liste pas). */
export const MAX_TRADE_LINKS = 5

export interface Evidence {
  /** Liste des trades déjà filtrée (erreur ou setup), sinon `null`. */
  filterTo: string | null
  /** Liens directs vers des trades, quand il n'y a pas de filtre. */
  tradeIds: number[]
  moreTrades: number
  reportTo: string
}

/** Les liens de preuve : filtre vers /trades quand il existe, sinon les trades en cause ; puis le rapport. */
export function insightEvidence(i: Insight): Evidence {
  const filterTo = i.filter === null ? null : i.filter.kind === 'mistake' ? mistakeLink({ source: i.filter.source, id: i.filter.id }) : `/trades?setup=${i.filter.tagId}`
  const ids = filterTo === null ? i.tradeIds : []
  return { filterTo, tradeIds: ids.slice(0, MAX_TRADE_LINKS), moreTrades: Math.max(0, ids.length - MAX_TRADE_LINKS), reportTo: reportLink(i.source) }
}

// --- Repère « nouveau » --------------------------------------------------------------------------

/** Un insight est nouveau s'il est apparu pour la première fois après la dernière visite de la page. */
export function isNewInsight(i: Pick<Insight, 'firstSeenAt' | 'dismissedAt'>, seenAt: number): boolean {
  return i.dismissedAt === null && (i.firstSeenAt === null || i.firstSeenAt > seenAt)
}

/** Nombre d'insights non vus (pastille de la barre latérale). */
export function unseenCount(insights: Pick<Insight, 'firstSeenAt' | 'dismissedAt'>[], seenAt: number): number {
  return insights.filter((i) => isNewInsight(i, seenAt)).length
}

const SEEN_KEY = 'pulse.insights.seenAt'

/** Date de la dernière visite de la page (préférence propre à ce PC ; 0 si rien n'est mémorisé ou si le stockage est indisponible). */
export function readSeenAt(): number {
  try {
    const v = Number(window.localStorage.getItem(SEEN_KEY))
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch {
    return 0
  }
}

export function writeSeenAt(ms: number): void {
  try {
    window.localStorage.setItem(SEEN_KEY, String(ms))
  } catch {
    /* stockage indisponible : le repère se réinitialisera, sans conséquence */
  }
}
