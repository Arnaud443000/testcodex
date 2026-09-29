import type { Decimal } from '../types/money'
import type {
  BucketStats,
  ConfidenceReport,
  ConfidenceVerdict,
  ConvictionBucket,
  ExecutionScore,
  Grade,
  JournalEntry,
  MissedTrade,
  PeriodQuery,
  QualityReport,
  Quadrant,
} from '../types/journal'
import type { Outcome, TradeData, TradeView } from '../types/trade'

/**
 * MOCK des analyses du journal — uniquement pour `npm run dev` dans un navigateur.
 * Il reproduit les règles de pulse-core (execution_quality.rs, confidence.rs, journal.rs)
 * pour développer l'interface sans Rust ; il ne fait pas foi : dans l'application,
 * tous les chiffres viennent de pulse-core. Les sommes d'argent restent exactes (BigInt).
 */

const SCALE = 8
const toScaled = (v: Decimal): bigint => {
  const neg = v.startsWith('-')
  const [i, f = ''] = (neg ? v.slice(1) : v).split('.')
  const n = BigInt(i + f.padEnd(SCALE, '0').slice(0, SCALE))
  return neg ? -n : n
}
const toDec = (n: bigint): Decimal => {
  const neg = n < 0n
  const digits = (neg ? -n : n).toString().padStart(SCALE + 1, '0')
  const frac = digits.slice(-SCALE).replace(/0+$/, '')
  return `${neg ? '-' : ''}${digits.slice(0, -SCALE)}${frac ? `.${frac}` : ''}`
}

export const GOOD_THRESHOLD = 70
export const MIN_TRADES_FOR_VERDICT = 10
export const PREDICTIVE_R = 0.3
export const HIGH_CONVICTION = 8

const percent = (part: number, whole: number) => (whole > 0 ? (part * 100) / whole : null)

export function mockExecutionScore(d: Pick<TradeData, 'checklist' | 'planFollowed' | 'ruleChecks' | 'executionQuality'>): ExecutionScore {
  const components = {
    checklist: percent(d.checklist.filter((c) => c.checked).length, d.checklist.length),
    plan: d.planFollowed ? { yes: 100, partial: 50, no: 0 }[d.planFollowed] : null,
    rules: percent(d.ruleChecks.filter((r) => r.respected).length, d.ruleChecks.length),
  }
  const parts = [components.checklist, components.plan, components.rules].filter((p): p is number => p !== null)
  const autoScore = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null
  const manual = d.executionQuality ?? null
  const score = manual !== null ? (manual - 1) * 25 : autoScore
  return {
    components,
    autoScore,
    manual,
    score,
    source: manual !== null ? 'manual' : autoScore !== null ? 'auto' : null,
    stars: score === null ? null : 1 + score / 25,
    grade: score === null ? null : score >= GOOD_THRESHOLD ? 'good' : 'poor',
  }
}

/** Trades clôturés dont la sortie tombe dans `[from, to)`. */
export function closedIn(views: TradeView[], q: PeriodQuery): TradeView[] {
  return views.filter(
    (v) =>
      v.figures !== null &&
      v.exitTime != null &&
      (q.from == null || v.exitTime >= q.from) &&
      (q.to == null || v.exitTime < q.to),
  )
}

export function mockQualityReport(views: TradeView[], q: PeriodQuery): QualityReport {
  const trades = closedIn(views, q)
  const cells: Quadrant[] = (['win', 'loss'] as Outcome[]).flatMap((outcome) =>
    (['good', 'poor'] as Grade[]).map((grade) => ({ outcome, grade, tradeCount: 0, netPnl: '0' })),
  )
  const sums = cells.map(() => 0n)
  let scored = 0
  let total = 0
  let breakeven = 0
  for (const v of trades) {
    const s = mockExecutionScore(v).score
    if (s === null || !v.figures) continue
    scored++
    total += s
    const grade: Grade = s >= GOOD_THRESHOLD ? 'good' : 'poor'
    const i = cells.findIndex((c) => c.outcome === v.figures!.outcome && c.grade === grade)
    if (i < 0) breakeven++
    else {
      cells[i].tradeCount++
      sums[i] += toScaled(v.figures.netPnl)
    }
  }
  cells.forEach((c, i) => (c.netPnl = toDec(sums[i])))
  const avg = scored ? total / scored : null
  return {
    currency: trades[0]?.currency ?? null,
    tradeCount: trades.length,
    scoredCount: scored,
    unscoredCount: trades.length - scored,
    averageScore: avg,
    averageStars: avg === null ? null : 1 + avg / 25,
    quadrants: cells,
    breakevenCount: breakeven,
  }
}

export const bucketOf = (c: number): ConvictionBucket => (c <= 3 ? 'low' : c <= 7 ? 'medium' : 'high')
const RANGES: Record<ConvictionBucket, [number, number]> = { low: [1, 3], medium: [4, 7], high: [8, 10] }

export function pearson(pairs: [number, number][]): number | null {
  if (pairs.length < 3) return null
  const n = pairs.length
  const mx = pairs.reduce((a, p) => a + p[0], 0) / n
  const my = pairs.reduce((a, p) => a + p[1], 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my)
    sxx += (x - mx) ** 2
    syy += (y - my) ** 2
  }
  if (sxx < 1e-12 || syy < 1e-12) return null
  return Math.max(-1, Math.min(1, sxy / (Math.sqrt(sxx) * Math.sqrt(syy))))
}

export function mockConfidenceReport(views: TradeView[], missed: MissedTrade[], q: PeriodQuery): ConfidenceReport {
  const trades = closedIn(views, q)
  const rated = trades.flatMap((v) => (v.conviction != null && v.figures ? [{ c: v.conviction, f: v.figures }] : []))
  const buckets: BucketStats[] = (['low', 'medium', 'high'] as ConvictionBucket[]).map((bucket) => {
    const group = rated.filter((r) => bucketOf(r.c) === bucket)
    const wins = group.filter((r) => r.f.outcome === 'win').length
    const rs = group.flatMap((r) => (r.f.rMultiple === null ? [] : [r.f.rMultiple]))
    const sum = group.reduce((a, r) => a + toScaled(r.f.netPnl), 0n)
    return {
      bucket,
      min: RANGES[bucket][0],
      max: RANGES[bucket][1],
      tradeCount: group.length,
      winCount: wins,
      winRate: group.length ? wins / group.length : null,
      avgNetPnl: group.length ? toDec(sum / BigInt(group.length)) : null,
      avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
      rTradeCount: rs.length,
    }
  })
  const pairs = rated.flatMap((r) => (r.f.rMultiple === null ? [] : [[r.c, r.f.rMultiple] as [number, number]]))
  const correlation = pearson(pairs)
  const verdict: ConfidenceVerdict =
    correlation === null || pairs.length < MIN_TRADES_FOR_VERDICT
      ? 'not_enough_data'
      : correlation >= PREDICTIVE_R
        ? 'predictive'
        : correlation <= -PREDICTIVE_R
          ? 'inverse'
          : 'not_predictive'
  const inWindow = missed.filter((m) => (q.from == null || m.occurredAt >= q.from) && (q.to == null || m.occurredAt < q.to))
  const convictions = inWindow.flatMap((m) => (m.conviction == null ? [] : [m.conviction]))
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)
  return {
    currency: trades[0]?.currency ?? null,
    ratedTradeCount: rated.length,
    buckets,
    correlation,
    correlationPairs: pairs.length,
    verdict,
    missed: {
      missedCount: inWindow.length,
      missedWithConviction: convictions.length,
      missedAvgConviction: mean(convictions),
      takenAvgConviction: mean(rated.map((r) => r.c)),
      missedHighConviction: convictions.filter((c) => c >= HIGH_CONVICTION).length,
    },
  }
}

export const isBlankEntry = (e: JournalEntry): boolean =>
  e.mood == null && e.sleepQuality == null && e.fatigue == null && !e.lateHours && !e.wentWell.trim() && !e.toImprove.trim() && !e.notes.trim()

/** « À compléter » : thèse ou émotions manquantes (même règle que pulse-core::journal::is_incomplete). */
export const isIncompleteData = (d: Pick<TradeData, 'thesis' | 'emotions'>): boolean => d.thesis.trim() === '' || d.emotions.length === 0

export const dayOf = (ms: number, tzOffsetMin: number): string => new Date(ms + tzOffsetMin * 60_000).toISOString().slice(0, 10)
