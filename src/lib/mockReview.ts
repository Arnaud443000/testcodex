import type { JournalEntry } from '../types/journal'
import type { ProcessPeriodInfo, ProcessProgress, ProcessProgressQuery } from '../types/processGoals'
import type { Summary, StatsQuery } from '../types/stats'
import type { DisciplineReport, MistakeReport } from '../types/behavior'
import type { PauseReport } from '../types/pause'
import type { IdeaView } from '../types/analysis'
import {
  MAX_ANSWER_CHARS,
  MAX_INTENTIONS,
  MAX_INTENTION_CHARS,
  MAX_REVIEW_STREAK,
  MIN_MISTAKE_TRADES,
  type Fact,
  type FactReason,
  type IntentionOutcome,
  type LastWeekIntentions,
  type ReviewAnswers,
  type ReviewDue,
  type ReviewErrorCode,
  type ReviewFacts,
  type ReviewInput,
  type ReviewIntention,
  type ReviewQuery,
  type ReviewReminderSettings,
  type WeekStatus,
  type WeeklyReview,
  type WeeklyReviewView,
} from '../types/review'
import { dayString, lastDay, parsePeriod, periodContaining, previousPeriod, nextPeriod, todayNumber, type CalendarPeriod } from './processPeriods'

/**
 * MOCK du bilan hebdomadaire (lot 36) — uniquement pour `npm run dev` dans un navigateur.
 * Miroir de `pulse-core/src/weekly_review.rs` (CLAUDE.md, « Bilan hebdomadaire (lot 36) ») : mêmes faits
 * relus des faux rapports existants (aucune formule ici), mêmes raisons quand un fait manque, mêmes refus
 * (`invalid input: review:<code>`), même série, même rappel. Vérifié par `mockReview.test.ts` sur les
 * mêmes cas que les tests Rust ; dans l'application, tout vient de pulse-core.
 *
 * Différence assumée : dans l'application une boucle d'une minute arme la bannière du dimanche ; ici,
 * il n'y a pas de boucle, `getReviewReminderPending` applique la même règle au moment où on le lui demande.
 */

const DAY = 86_400_000
const MIN = 60_000
export const DEFAULT_REVIEW_REMINDER: ReviewReminderSettings = { enabled: true, time: '18:00', day: 'sunday' }

const refuse = (code: ReviewErrorCode) => new Error(`invalid input: review:${code}`)

const emptyAnswers = (): ReviewAnswers => ({ wentWell: '', doDifferently: '', nextPriority: '' })

/** « HH:MM » → minutes depuis minuit ; `null` pour tout le reste (« 24:00 », « 9:5 », « 20h »). */
const parseTime = (s: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(s)
  if (!m) return null
  const [h, mi] = [Number(m[1]), Number(m[2])]
  return h < 24 && mi < 60 ? h * 60 + mi : null
}

export interface ReviewDeps {
  /** Rapports existants (refusent les devises mélangées, comme pulse-core). */
  summary: (q: StatsQuery) => Summary
  discipline: (q: StatsQuery) => DisciplineReport
  mistakes: (q: StatsQuery) => MistakeReport
  pauses: (q: StatsQuery) => PauseReport
  goals: (q: ProcessProgressQuery) => Promise<ProcessProgress>
  ideas: (status: 'active' | 'closed', tzOffsetMin: number, nowMs: number) => Promise<IdeaView[]>
  journal: () => JournalEntry[]
  /** Devise des comptes choisis (`null` sans compte). */
  currency: (accountIds: number[]) => string | null
  /** Trades clôturés de la fenêtre `[from, to)` des comptes actifs, sans contrôle de devise. */
  closedCount: (from: number, to: number) => number
  now: () => number
}

const lacks = <T>(reason: FactReason): Fact<T> => ({ value: null, reason })
const has = <T>(value: T): Fact<T> => ({ value, reason: null })
const of = <T>(value: T | null, reason: FactReason): Fact<T> => (value === null ? lacks(reason) : has(value))

export function createReviewMock(deps: ReviewDeps) {
  let reviews: WeeklyReview[] = []
  let nextReviewId = 1
  let nextIntentionId = 1
  let reminder: ReviewReminderSettings = { ...DEFAULT_REVIEW_REMINDER }
  let lastSent: string | null = null
  let dismissed: string | null = null
  /** Horloge imposée (scénarios d'audit : un dimanche à 18:30 sans attendre) ; `null` = l'heure réelle. */
  let clock: number | null = null
  const now = () => clock ?? deps.now()

  const clone = (r: WeeklyReview): WeeklyReview => structuredClone(r)
  const find = (key: string) => reviews.find((r) => r.periodKey === key)
  const week = (key: string): CalendarPeriod => {
    const p = parsePeriod('week', key)
    if (!p) throw new Error(`invalid input: invalid week "${key}" (expected YYYY-Www)`)
    return p
  }
  const stateOf = (r: WeeklyReview | undefined) => (!r ? 'todo' : r.completedAt !== null ? 'done' : 'draft')

  function describe(p: CalendarPeriod): Pick<WeeklyReview, 'periodKey' | 'firstDay' | 'lastDay'> {
    return { periodKey: p.key, firstDay: dayString(p.firstDay), lastDay: dayString(lastDay(p)) }
  }

  function checkOffsets(tz: number, boundary: Record<string, number>) {
    for (const [day, offset] of Object.entries(boundary)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`invalid input: invalid day "${day}"`)
      if (Math.abs(offset) > 18 * 60) throw new Error(`invalid input: invalid UTC offset ${offset}`)
    }
    if (Math.abs(tz) > 18 * 60) throw new Error(`invalid input: invalid UTC offset ${tz}`)
  }

  const windowOf = (p: CalendarPeriod, tz: number, boundary: Record<string, number>) => {
    const midnight = (day: number) => day * DAY - (boundary[dayString(day)] ?? tz) * MIN
    return { from: midnight(p.firstDay), to: midnight(p.firstDay + p.days) }
  }

  function periodInfo(p: CalendarPeriod, q: Pick<ReviewQuery, 'nowMs' | 'tzOffsetMin' | 'boundaryOffsets'>): ProcessPeriodInfo {
    const today = todayNumber(q.nowMs, q.tzOffsetMin)
    return {
      kind: 'week',
      key: p.key,
      firstDay: dayString(p.firstDay),
      lastDay: dayString(lastDay(p)),
      ...windowOf(p, q.tzOffsetMin, q.boundaryOffsets),
      state: today > lastDay(p) ? 'past' : today < p.firstDay ? 'future' : 'current',
      previousKey: previousPeriod(p).key,
      nextKey: nextPeriod(p).key,
    }
  }

  const filledJournalDays = (p: CalendarPeriod) => {
    const [first, last] = [dayString(p.firstDay), dayString(lastDay(p))]
    return deps.journal().filter((e) => e.day >= first && e.day <= last).length
  }

  async function facts(q: ReviewQuery, p: CalendarPeriod, info: ProcessPeriodInfo): Promise<ReviewFacts> {
    checkOffsets(q.tzOffsetMin, q.boundaryOffsets)
    const query: StatsQuery = { accountIds: q.accountIds, from: info.from, to: info.to }
    const summary = deps.summary(query)
    const discipline = deps.discipline(query)
    const mistakes = deps.mistakes(query)
    const pauses = deps.pauses(query)
    const goals = (
      await deps.goals({ accountIds: q.accountIds, periodKind: 'week', periodKey: q.periodKey, nowMs: q.nowMs, tzOffsetMin: q.tzOffsetMin, boundaryOffsets: q.boundaryOffsets })
    ).goals
    const none = summary.tradeCount === 0
    const closed = (await deps.ideas('closed', q.tzOffsetMin, q.nowMs)).filter((i) => i.closedAt !== null && i.closedAt >= info.from && i.closedAt < info.to).length
    const toReview: Fact<number> =
      info.state === 'current'
        ? has((await deps.ideas('active', q.tzOffsetMin, q.nowMs)).filter((v) => v.stale).length)
        : lacks('onlyCurrentWeek')
    const top = mistakes.byCost[0]
    let costly: ReviewFacts['costlyMistake']
    if (!top) costly = lacks('noMistake')
    else if (/^-?0+(\.0+)?$/.test(top.cost)) costly = lacks('noMistakeCost')
    else if (top.tradeCount < MIN_MISTAKE_TRADES) costly = lacks('notEnoughMistakeTrades')
    else costly = has({ source: top.source, id: top.id, label: top.label, tradeCount: top.tradeCount, cost: top.cost, tradeIds: [...top.tradeIds] })
    return {
      closedTradeCount: summary.tradeCount,
      netPnl: none ? lacks('noClosedTrade') : has(summary.netPnl),
      winRate: of(summary.winRate, 'noClosedTrade'),
      expectancyR: of(summary.expectancyR, none ? 'noClosedTrade' : 'noRTrade'),
      rTradeCount: summary.rTradeCount,
      discipline: of(discipline.score, none ? 'noClosedTrade' : 'notEnoughTrades'),
      scoredTradeCount: discipline.scoredTradeCount,
      minScoredTradeCount: discipline.minTradeCount,
      goals: goals.length === 0 ? lacks('noGoals') : has(goals),
      pauseCount: pauses.pauseCount,
      tradesDuringPause: pauses.during.summary.tradeCount,
      ideasClosed: closed,
      ideasToReview: toReview,
      costlyMistake: costly,
      journalDays: filledJournalDays(p),
    }
  }

  /** Semaines de suite avant `p` où au moins une intention a été tenue. */
  function streak(p: CalendarPeriod): number {
    let count = 0
    let prev = previousPeriod(p)
    while (count < MAX_REVIEW_STREAK) {
      const r = find(prev.key)
      if (!r || !r.intentions.some((i) => i.outcome === 'kept')) break
      count++
      prev = previousPeriod(prev)
    }
    return count
  }

  function cleanAnswers(a: ReviewAnswers): ReviewAnswers {
    const out = emptyAnswers()
    for (const key of Object.keys(out) as (keyof ReviewAnswers)[]) {
      const text = (a[key] ?? '').replace(/\r/g, '').trim()
      if ([...text].length > MAX_ANSWER_CHARS) throw refuse('answerTooLong')
      out[key] = text
    }
    return out
  }

  function cleanIntentions(list: string[]): string[] {
    const kept = list.map((s) => s.split(/\s+/).filter(Boolean).join(' ')).filter((s) => s.length > 0)
    if (kept.length > MAX_INTENTIONS) throw refuse('tooManyIntentions')
    if (kept.some((s) => [...s].length > MAX_INTENTION_CHARS)) throw refuse('intentionTooLong')
    return kept
  }

  // --- Rappel ------------------------------------------------------------------------------

  const weekdayOf = (nowMs: number, tz: number) => ((((todayNumber(nowMs, tz) + 3) % 7) + 7) % 7) + 1
  const minutesOfDay = (nowMs: number, tz: number) => Math.floor((((nowMs + tz * MIN) % DAY) + DAY) % DAY / MIN)
  const currentWeekKey = (nowMs: number, tz: number) => periodContaining('week', todayNumber(nowMs, tz)).key

  function weekActivity(nowMs: number, tz: number, boundary: Record<string, number>): ReviewDue | null {
    checkOffsets(tz, boundary)
    const p = periodContaining('week', todayNumber(nowMs, tz))
    const { from, to } = windowOf(p, tz, boundary)
    const closed = deps.closedCount(from, to)
    const days = filledJournalDays(p)
    return closed > 0 || days > 0 ? { periodKey: p.key, closedTradeCount: closed, journalDays: days } : null
  }

  function check(nowMs: number, tz: number, boundary: Record<string, number>): ReviewDue | null {
    if (!reminder.enabled || weekdayOf(nowMs, tz) !== 7 || minutesOfDay(nowMs, tz) < (parseTime(reminder.time) ?? 0)) return null
    const key = currentWeekKey(nowMs, tz)
    if (lastSent === key || stateOf(find(key)) === 'done') return null
    return weekActivity(nowMs, tz, boundary)
  }

  return {
    /** Pour les tests et le faux backend : remet tout à zéro. */
    reset: () => {
      reviews = []
      nextReviewId = 1
      nextIntentionId = 1
      reminder = { ...DEFAULT_REVIEW_REMINDER }
      lastSent = null
      dismissed = null
      clock = null
    },
    /** Pour les scénarios d'audit seulement : impose l'heure que voit le faux backend du bilan (`null` = l'heure réelle). */
    setClock: (ms: number | null) => {
      clock = ms
    },
    /** Écriture directe pour les scénarios d'audit : une semaine entière de bilan, sans règle de date. */
    seed: (review: Omit<WeeklyReview, 'id' | 'firstDay' | 'lastDay' | 'state' | 'intentions'> & { intentions: { text: string; outcome: IntentionOutcome | null }[] }) => {
      const p = week(review.periodKey)
      const saved: WeeklyReview = {
        ...review,
        ...describe(p),
        id: nextReviewId++,
        state: review.completedAt !== null ? 'done' : 'draft',
        intentions: review.intentions.map((i, n) => ({ id: nextIntentionId++, position: n + 1, text: i.text, outcome: i.outcome })),
      }
      reviews = [...reviews.filter((r) => r.periodKey !== saved.periodKey), saved]
      return clone(saved)
    },

    getWeeklyReview: async (q: ReviewQuery): Promise<WeeklyReviewView> => {
      const p = week(q.periodKey)
      const info = periodInfo(p, q)
      const f = await facts(q, p, info)
      const before = find(previousPeriod(p).key)
      const lastWeek: LastWeekIntentions | null =
        before && before.intentions.length > 0
          ? { periodKey: before.periodKey, firstDay: before.firstDay, lastDay: before.lastDay, intentions: structuredClone(before.intentions) }
          : null
      return {
        period: info,
        currency: deps.currency(q.accountIds),
        facts: f,
        review: find(q.periodKey) ? clone(find(q.periodKey)!) : null,
        lastWeek,
        streak: streak(p),
      }
    },

    saveWeeklyReview: async (input: ReviewInput, tzOffsetMin: number): Promise<WeeklyReview> => {
      const p = week(input.periodKey)
      const answers = cleanAnswers(input.answers)
      const texts = cleanIntentions(input.intentions)
      if (Object.values(answers).every((a) => a === '') && texts.length === 0) throw refuse('empty')
      const at = now()
      if (todayNumber(at, tzOffsetMin) < p.firstDay) throw refuse('future')
      let r = find(input.periodKey)
      if (!r) {
        r = { id: nextReviewId++, ...describe(p), createdAt: at, updatedAt: at, completedAt: null, state: 'draft', answers, intentions: [] }
        reviews.push(r)
      }
      r.updatedAt = at
      r.answers = answers
      // Une intention dont le texte n'a pas changé garde son suivi ; une intention modifiée repart « non évaluée ».
      r.intentions = texts.map((text, i): ReviewIntention => {
        const old = r!.intentions.find((x) => x.position === i + 1)
        return old && old.text === text ? old : { id: old?.id ?? nextIntentionId++, position: i + 1, text, outcome: null }
      })
      return clone(r)
    },

    completeWeeklyReview: async (periodKey: string): Promise<WeeklyReview> => {
      week(periodKey)
      const r = find(periodKey)
      if (!r) throw new Error(`not found: weekly review ${periodKey}`)
      if (r.completedAt === null) {
        r.completedAt = now()
        r.updatedAt = r.completedAt
        r.state = 'done'
      }
      return clone(r)
    },

    deleteWeeklyReview: async (periodKey: string): Promise<boolean> => {
      week(periodKey)
      const before = reviews.length
      reviews = reviews.filter((r) => r.periodKey !== periodKey)
      return reviews.length < before
    },

    listWeeklyReviews: async (limit?: number): Promise<WeeklyReview[]> =>
      [...reviews].sort((a, b) => b.periodKey.localeCompare(a.periodKey)).slice(0, Math.min(limit ?? 520, 520)).map(clone),

    setIntentionOutcome: async (intentionId: number, outcome: IntentionOutcome | null): Promise<ReviewIntention> => {
      for (const r of reviews) {
        const i = r.intentions.find((x) => x.id === intentionId)
        if (i) {
          i.outcome = outcome
          return { ...i }
        }
      }
      throw new Error(`not found: intention ${intentionId}`)
    },

    getWeeklyReviewStatus: async (tzOffsetMin: number): Promise<WeekStatus> => {
      const p = periodContaining('week', todayNumber(now(), tzOffsetMin))
      const current = find(p.key)
      const before = find(previousPeriod(p).key)
      const source = current && current.intentions.length > 0 ? current : before && before.intentions.length > 0 ? before : undefined
      return {
        ...describe(p),
        state: stateOf(current),
        intentions: source ? structuredClone(source.intentions) : [],
        intentionsFrom: source?.periodKey ?? null,
      }
    },

    getReviewReminder: async (): Promise<ReviewReminderSettings> => ({ ...reminder }),

    setReviewReminder: async (s: ReviewReminderSettings): Promise<ReviewReminderSettings> => {
      if (parseTime(s.time) === null) throw refuse('badTime')
      if (s.day !== 'sunday') throw refuse('badDay')
      reminder = { enabled: s.enabled, time: s.time, day: 'sunday' }
      return { ...reminder }
    },

    /** Même règle que la boucle de la coque, appliquée à la demande (voir l'en-tête). */
    getReviewReminderPending: async (tzOffsetMin: number, boundaryOffsets: Record<string, number> = {}): Promise<ReviewDue | null> => {
      const at = now()
      const armed = check(at, tzOffsetMin, boundaryOffsets)
      if (armed) lastSent = armed.periodKey
      const key = currentWeekKey(at, tzOffsetMin)
      if (!reminder.enabled || lastSent !== key || dismissed === key || stateOf(find(key)) === 'done') return null
      return weekActivity(at, tzOffsetMin, boundaryOffsets)
    },

    dismissReviewReminder: async (tzOffsetMin: number): Promise<void> => {
      dismissed = currentWeekKey(now(), tzOffsetMin)
    },

    /** Pour les tests : la boucle de la coque, un tour. */
    tick: (nowMs: number, tzOffsetMin: number, boundaryOffsets: Record<string, number> = {}): ReviewDue | null => {
      const due = check(nowMs, tzOffsetMin, boundaryOffsets)
      if (due) lastSent = due.periodKey
      return due
    },
    markSent: (key: string) => {
      week(key)
      lastSent = key
    },
  }
}
