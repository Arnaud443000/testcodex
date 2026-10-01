import type { Decimal } from '../types/money'
import type { JournalEntry } from '../types/journal'
import type { StatsQuery } from '../types/stats'
import type {
  NewProcessGoal,
  ProcessDirection,
  ProcessGoal,
  ProcessGoalProgress,
  ProcessMetric,
  ProcessPeriodKind,
  ProcessProgress,
  ProcessProgressQuery,
  ProcessStatus,
  ProcessUnit,
  RequiredSetting,
} from '../types/processGoals'
import { PROCESS_METRICS } from '../types/processGoals'
import { mockDiscipline, mockPatterns, mockPlan, mockRuleAdherence, type BehaviorInput } from './mockBehavior'
import { mockRiskBenchmark } from './mockComparisons'
import { MAX_STREAK, dayString, lastDay, nextPeriod, parsePeriod, previousPeriod, todayNumber, type CalendarPeriod } from './processPeriods'

/**
 * MOCK des objectifs de comportement (lot 34) — uniquement pour `npm run dev` dans un navigateur.
 * Miroir des règles de pulse-core::process_goals, en relisant les faux rapports existants
 * (discipline, patterns, benchmark du risque, respect des règles, plan, journal) ; il ne fait pas
 * foi : dans l'application, tout vient de pulse-core. Mêmes refus, mêmes messages.
 */

const DAY = 86_400_000
const MIN_PLAN_TRADES = 5
const MAX_COUNT_TARGET = 10_000n
const invalid = (m: string) => new Error(`invalid input: ${m}`)

export const directionOf = (m: ProcessMetric): ProcessDirection =>
  m === 'no_stop_trades' || m === 'overtrading_days' || m === 'revenge_trades' || m === 'risk_breaches' ? 'atMost' : 'atLeast'
export const unitOf = (m: ProcessMetric): ProcessUnit => (m === 'rules_respect_rate' || m === 'plan_follow_rate' ? 'percent' : 'count')
export const requiredSettingOf = (m: ProcessMetric): RequiredSetting | null =>
  m === 'overtrading_days' ? 'maxTradesPerDay' : m === 'risk_breaches' ? 'maxRiskPercent' : null

/** Décimal exact : entier × 10^-scale. */
interface Exact {
  n: bigint
  scale: number
}
function exact(v: Decimal): Exact | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(v.trim())
  if (!m) return null
  const n = BigInt(m[2] + (m[3] ?? ''))
  return { n: m[1] ? -n : n, scale: (m[3] ?? '').length }
}
const pow10 = (s: number) => 10n ** BigInt(s)
const isWhole = (e: Exact) => e.n % pow10(e.scale) === 0n
const wholePart = (e: Exact) => e.n / pow10(e.scale)

function checkPeriod(kind: ProcessPeriodKind, key: string): CalendarPeriod {
  const p = parsePeriod(kind, key)
  if (!p) throw invalid(kind === 'week' ? `invalid week "${key}" (expected YYYY-Www)` : `invalid month "${key}" (expected YYYY-MM)`)
  return p
}

/** Contrôles de `process_goals::validate_target` ; renvoie la cible enregistrée (entiers sans décimales). */
export function checkProcessTarget(kind: ProcessPeriodKind, metric: ProcessMetric, target: Decimal): Decimal {
  const e = exact(target)
  if (!e) throw invalid(`target: "${target}" is not a decimal number`)
  if (metric === 'rules_respect_rate' || metric === 'plan_follow_rate') {
    if (e.n <= 0n || e.n > 100n * pow10(e.scale)) throw invalid('a rate target is a percentage above 0 and at most 100')
    return target.trim()
  }
  if (metric === 'journal_days') {
    const max = kind === 'week' ? 7n : 31n
    if (!isWhole(e) || wholePart(e) < 1n || wholePart(e) > max) {
      throw invalid(kind === 'week' ? 'a weekly journal target is a whole number of days from 1 to 7' : 'a monthly journal target is a whole number of days from 1 to 31')
    }
    return wholePart(e).toString()
  }
  if (!isWhole(e) || wholePart(e) < 0n || wholePart(e) > MAX_COUNT_TARGET) throw invalid('a ceiling is a whole number from 0 to 10000')
  return wholePart(e).toString()
}

/** Ce qu'une métrique a mesuré sur une période. */
interface Measure {
  value: number | null
  count: number | null
  ratio: [number, number] | null
  tradeCount: number
  settingRequired: boolean
  tradeIds: number[]
  days: string[]
}
const empty = (tradeCount: number): Measure => ({ value: null, count: null, ratio: null, tradeCount, settingRequired: false, tradeIds: [], days: [] })
const counted = (n: number, tradeCount: number, more: Partial<Measure> = {}): Measure => ({ ...empty(tradeCount), value: n, count: n, ...more })
const rated = (num: number, den: number, tradeCount: number): Measure => ({ ...empty(tradeCount), value: (num * 100) / den, ratio: [num, den] })

/** −1, 0, +1 contre la cible, comparaison exacte ; `null` sans valeur. */
function compare(m: Measure, target: Decimal): number | null {
  const t = exact(target)
  if (!t) return null
  let left: bigint
  let right: bigint
  if (m.count !== null) {
    left = BigInt(m.count) * pow10(t.scale)
    right = t.n
  } else if (m.ratio) {
    left = BigInt(m.ratio[0]) * 100n * pow10(t.scale)
    right = t.n * BigInt(m.ratio[1])
  } else return null
  return left > right ? 1 : left < right ? -1 : 0
}

function statusOf(m: Measure, direction: ProcessDirection, target: Decimal, over: boolean): ProcessStatus {
  if (m.settingRequired) return 'settingRequired'
  const c = compare(m, target)
  if (c === null) return 'noData'
  if (direction === 'atMost') return c > 0 ? 'exceeded' : over ? 'respected' : 'respectedSoFar'
  return c >= 0 ? 'reached' : over ? 'missed' : 'inProgress'
}

export interface ProcessGoalsDeps {
  /** Données des comptes choisis (refuse les devises mélangées, comme pulse-core). */
  input: (accountIds: number[]) => BehaviorInput & { currency: string | null }
  journal: () => JournalEntry[]
}

export function createProcessGoalsMock(deps: ProcessGoalsDeps) {
  const goals: ProcessGoal[] = []
  let nextId = 1
  const order = (a: ProcessGoal, b: ProcessGoal) => PROCESS_METRICS.indexOf(a.metric) - PROCESS_METRICS.indexOf(b.metric)
  const listOf = (kind: ProcessPeriodKind, key: string) =>
    goals.filter((g) => g.periodKind === kind && g.periodKey === key).sort(order).map((g) => ({ ...g }))

  function measure(input: BehaviorInput, entries: JournalEntry[], q: StatsQuery, p: CalendarPeriod, metric: ProcessMetric): Measure {
    const discipline = mockDiscipline(input, q)
    const tradeCount = discipline.trades.length
    const noneWithoutTrades = (m: Measure) => (tradeCount === 0 ? empty(0) : m)
    switch (metric) {
      case 'no_stop_trades': {
        const ids = discipline.trades.filter((t) => !t.hasStopLoss).map((t) => t.tradeId)
        return noneWithoutTrades(counted(ids.length, tradeCount, { tradeIds: ids }))
      }
      case 'revenge_trades': {
        const ids = mockPatterns(input, q).revengeTrades.map((r) => r.tradeId)
        return noneWithoutTrades(counted(ids.length, tradeCount, { tradeIds: ids }))
      }
      case 'overtrading_days': {
        if (input.settings.maxTradesPerDay === null) return { ...empty(tradeCount), settingRequired: true }
        const days = mockPatterns(input, q).overtradingDays
        return noneWithoutTrades(counted(days.length, tradeCount, { tradeIds: days.flatMap((d) => d.tradeIds), days: days.map((d) => d.day) }))
      }
      case 'risk_breaches': {
        if (input.settings.maxRiskPercent === null) return { ...empty(tradeCount), settingRequired: true }
        const bench = mockRiskBenchmark(input, q)
        if (bench.evaluatedCount === 0) return empty(tradeCount)
        return counted(bench.overCount, tradeCount, { tradeIds: bench.violations.map((v) => v.tradeId).reverse() })
      }
      case 'rules_respect_rate': {
        const r = mockRuleAdherence(input, q)
        return r.checks === 0 ? empty(tradeCount) : rated(r.respected, r.checks, tradeCount)
      }
      case 'plan_follow_rate': {
        const groups = mockPlan(input, q).groups
        const count = (key: string) => groups.find((g) => g.key === key)?.summary.tradeCount ?? 0
        const declared = count('yes') + count('partial') + count('no')
        return declared < MIN_PLAN_TRADES ? empty(tradeCount) : rated(count('yes'), declared, tradeCount)
      }
      case 'journal_days': {
        const [first, last] = [dayString(p.firstDay), dayString(lastDay(p))]
        const days = entries.map((e) => e.day).filter((d) => d >= first && d <= last).sort()
        return counted(days.length, tradeCount, { days })
      }
    }
  }

  return {
    setProcessGoal: async (n: NewProcessGoal): Promise<ProcessGoal> => {
      const p = checkPeriod(n.periodKind, n.periodKey)
      const target = checkProcessTarget(n.periodKind, n.metric, n.target)
      const existing = goals.find((g) => g.periodKind === p.kind && g.periodKey === p.key && g.metric === n.metric)
      if (existing) {
        existing.target = target
        return { ...existing }
      }
      const g: ProcessGoal = { id: nextId++, periodKind: p.kind, periodKey: p.key, metric: n.metric, target }
      goals.push(g)
      return { ...g }
    },
    listProcessGoals: async (kind: ProcessPeriodKind, key: string): Promise<ProcessGoal[]> => {
      checkPeriod(kind, key)
      return listOf(kind, key)
    },
    deleteProcessGoal: async (id: number): Promise<void> => {
      const i = goals.findIndex((g) => g.id === id)
      if (i < 0) throw new Error(`not found: process goal ${id}`)
      goals.splice(i, 1)
    },
    copyProcessGoals: async (kind: ProcessPeriodKind, key: string): Promise<ProcessGoal[]> => {
      const p = checkPeriod(kind, key)
      const previous = previousPeriod(p).key
      for (const g of goals.filter((x) => x.periodKind === kind && x.periodKey === previous).sort((a, b) => a.id - b.id)) {
        if (!goals.some((x) => x.periodKind === kind && x.periodKey === p.key && x.metric === g.metric)) {
          goals.push({ id: nextId++, periodKind: kind, periodKey: p.key, metric: g.metric, target: g.target })
        }
      }
      return listOf(kind, key)
    },
    getProcessGoalProgress: async (q: ProcessProgressQuery): Promise<ProcessProgress> => {
      const period = checkPeriod(q.periodKind, q.periodKey)
      for (const [day, offset] of Object.entries(q.boundaryOffsets ?? {})) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw invalid(`invalid day "${day}"`)
        if (Math.abs(offset) > 18 * 60) throw invalid(`invalid UTC offset ${offset}`)
      }
      if (Math.abs(q.tzOffsetMin) > 18 * 60) throw invalid(`invalid UTC offset ${q.tzOffsetMin}`)
      const input = deps.input(q.accountIds)
      const entries = deps.journal()
      const midnight = (day: number) => day * DAY - (q.boundaryOffsets?.[dayString(day)] ?? q.tzOffsetMin) * 60_000
      const window = (p: CalendarPeriod) => ({ from: midnight(p.firstDay), to: midnight(p.firstDay + p.days) })
      const query = (p: CalendarPeriod): StatsQuery => ({ accountIds: q.accountIds, ...window(p) })
      const today = todayNumber(q.nowMs, q.tzOffsetMin)
      const isOver = (p: CalendarPeriod) => today > lastDay(p)
      const { from, to } = window(period)

      const result: ProcessGoalProgress[] = listOf(q.periodKind, q.periodKey).map((goal) => {
        const m = measure(input, entries, query(period), period, goal.metric)
        const direction = directionOf(goal.metric)
        let streak = 0
        let p = previousPeriod(period)
        while (streak < MAX_STREAK && isOver(p)) {
          const g = goals.find((x) => x.periodKind === q.periodKind && x.periodKey === p.key && x.metric === goal.metric)
          if (!g) break
          const s = statusOf(measure(input, entries, query(p), p, goal.metric), direction, g.target, true)
          if (s !== 'respected' && s !== 'reached') break
          streak++
          p = previousPeriod(p)
        }
        return {
          goal,
          direction,
          unit: unitOf(goal.metric),
          value: m.value,
          numerator: m.ratio?.[0] ?? null,
          denominator: m.ratio?.[1] ?? null,
          tradeCount: m.tradeCount,
          status: statusOf(m, direction, goal.target, isOver(period)),
          requiredSetting: m.settingRequired ? requiredSettingOf(goal.metric) : null,
          streak,
          tradeIds: m.tradeIds,
          days: m.days,
        }
      })
      return {
        period: {
          kind: period.kind,
          key: period.key,
          firstDay: dayString(period.firstDay),
          lastDay: dayString(lastDay(period)),
          from,
          to,
          state: isOver(period) ? 'past' : today < period.firstDay ? 'future' : 'current',
          previousKey: previousPeriod(period).key,
          nextKey: nextPeriod(period).key,
        },
        currency: input.currency,
        maxTradesPerDay: input.settings.maxTradesPerDay,
        maxRiskPercent: input.settings.maxRiskPercent,
        goals: result,
      }
    },
  }
}
