/**
 * Faux backend de l'analyse avant trading, des idées à surveiller et de la revue du lendemain (lot 31) :
 * miroir de `crates/pulse-core/src/analysis/` (mêmes règles, mêmes messages, vérifié par
 * `mockAnalysis.test.ts` sur les mêmes cas que les tests Rust). Fonctions pures sur un état en mémoire ;
 * le jour local est toujours celui du PC (`tzOffsetMin` fourni par l'appelant), jamais UTC.
 */
import type {
  Analysis,
  AnalysisInput,
  AnalysisReport,
  AnalysisSettings,
  AnswerValue,
  Idea,
  IdeaInput,
  IdeaNote,
  IdeaOutcome,
  IdeaOutcomes,
  IdeaStatus,
  IdeaView,
  LinkedComparison,
  NewsBlock,
  Question,
  QuestionKind,
  ReviewBanner,
  ReviewQueue,
  Timeframe,
  TradeLinks,
  TrendValue,
} from '../types/analysis'
import { MAX_SNOOZE_DAYS, MAX_STALE_DAYS, MIN_SNOOZE_DAYS, MIN_STALE_DAYS, TIMEFRAMES, TRENDS } from '../types/analysis'
import type { EconomicEvent } from '../types/news'
import type { StatsQuery } from '../types/stats'
import type { Tag } from '../types/trade'

export const MIN_SAMPLE = 5
export const REVIEW_VISIBLE = 5
export const DEFAULT_STALE_DAYS = 7
const DAY = 86_400_000

const invalid = (m: string) => new Error(`invalid input: ${m}`)
const notFound = (m: string) => new Error(`not found: ${m}`)
const squeeze = (s: string) => s.split(/\s+/).filter(Boolean).join(' ')
const optText = (field: string, s: string | null | undefined, max: number): string | null => {
  const t = (s ?? '').trim()
  if (!t) return null
  if ([...t].length > max) throw invalid(`${field} is limited to ${max} characters`)
  return t
}

// --- jours locaux (miroir de `stats::time`) -----------------------------------------------------
export const localDayNumber = (ms: number, tz: number) => Math.floor((ms + tz * 60_000) / DAY)
export const dayKeyOfNumber = (n: number) => new Date(n * DAY).toISOString().slice(0, 10)
export const dayOf = (ms: number, tz: number) => dayKeyOfNumber(localDayNumber(ms, tz))
const parseDay = (day: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return dayKeyOfNumber(t / DAY) === day ? t / DAY : null
}
const checkDay = (field: string, day: string) => {
  if (parseDay(day) === null) throw invalid(`${field} must be a day YYYY-MM-DD`)
}

// --- questions d'origine (migration v15) --------------------------------------------------------
const SEED: [string, QuestionKind, Question['options']][] = [
  ['trend', 'trend', { timeframes: ['monthly', 'weekly', 'daily', 'h4', 'h1'] }],
  ['levels', 'longText', {}],
  ['news', 'news', {}],
  ['alts', 'longText', {}],
  ['scenarioMain', 'longText', {}],
  ['scenarioAlt', 'longText', {}],
  ['invalidation', 'longText', {}],
  ['assets', 'shortText', {}],
  ['setups', 'setups', {}],
  ['conviction', 'conviction', {}],
  ['riskLimits', 'shortText', {}],
  ['state', 'emotions', {}],
  ['mistakeToAvoid', 'shortText', {}],
]

export interface AnalysisDeps {
  instruments: () => { id: number; symbol: string }[]
  tags: () => Tag[]
  tradeExists: (id: number) => boolean
  news: { enabled: () => boolean; eventsOfDay: (parisDay: string) => EconomicEvent[] }
  /** Comparaison des trades liés / non liés (réutilise la discipline et l'expectancy du faux backend). */
  comparison: (query: StatsQuery, linked: Set<number>) => LinkedComparison
  now: () => number
}

export function createAnalysisMock(deps: AnalysisDeps) {
  let questions: Question[] = SEED.map(([key, kind, options], i) => ({ id: i + 1, key, label: null, kind, position: i + 1, archived: false, options: structuredClone(options) }))
  let nextQuestionId = SEED.length + 1
  const analyses = new Map<number, Analysis>()
  let nextAnalysisId = 1
  const ideas = new Map<number, Idea>()
  let nextIdeaId = 1
  let nextNoteId = 1
  const tradeIdeas = new Map<number, Set<number>>()
  const tradeAnalyses = new Map<number, Set<number>>()
  const settings = new Map<string, string>()

  // --- questions -------------------------------------------------------------------------------
  const questionOf = (id: number) => {
    const q = questions.find((x) => x.id === id)
    if (!q) throw notFound(`analysis question ${id}`)
    return q
  }
  function cleanOptions(kind: QuestionKind, options: Question['options']): Question['options'] {
    if (kind === 'trend') {
      const asked = (options.timeframes ?? []) as string[]
      const bad = asked.find((t) => !(TIMEFRAMES as readonly string[]).includes(t))
      if (bad) throw invalid(`unknown time frame "${bad}"`)
      const chosen = TIMEFRAMES.filter((t) => asked.includes(t))
      if (!chosen.length) throw invalid('at least one time frame must be shown')
      return { timeframes: chosen }
    }
    if (kind === 'choice') {
      const choices: string[] = []
      for (const c of options.choices ?? []) {
        const t = optText('choice', c, 80)
        if (t && !choices.some((x) => x.toLowerCase() === t.toLowerCase())) choices.push(t)
      }
      if (choices.length < 2 || choices.length > 12) throw invalid('a single-choice question needs 2 to 12 choices')
      return { choices }
    }
    return {}
  }
  const sortedQuestions = () => [...questions].sort((a, b) => a.position - b.position || a.id - b.id)

  // --- réponses --------------------------------------------------------------------------------
  const text = (v: unknown, field: string, max: number): string | null => {
    if (v == null) return null
    if (typeof v !== 'string') throw invalid(`${field} must be text`)
    return optText(field, v, max)
  }
  function tagIds(v: unknown, kind: Tag['kind'], max: number, field: string): number[] {
    const out: number[] = []
    for (const x of Array.isArray(v) ? v : []) {
      if (!Number.isInteger(x)) throw invalid(`${field} must be tag ids`)
      const tag = deps.tags().find((g) => g.id === x)
      if (!tag) throw notFound(`tag ${x}`)
      if (tag.kind !== kind) throw invalid(`${field}: tag ${x} has the wrong kind`)
      if (!out.includes(x)) out.push(x)
    }
    if (out.length > max) throw invalid(`${field} is limited to ${max} items`)
    return out
  }
  /** Réponse sous forme canonique ; `null` = vide (rien n'est écrit). */
  function normalize(q: Question, value: AnswerValue | undefined): AnswerValue | null {
    const v = value === undefined ? null : value
    switch (q.kind) {
      case 'shortText': return text(v, 'answer', 300)
      case 'longText': return text(v, 'answer', 4000)
      case 'choice': {
        const c = text(v, 'answer', 300)
        if (c !== null && !(q.options.choices ?? []).includes(c)) throw invalid(`"${c}" is not one of the choices`)
        return c
      }
      case 'conviction': {
        if (v === null) return null
        if (typeof v !== 'number' || !Number.isInteger(v)) throw invalid('conviction must be a whole number')
        if (v < 1 || v > 10) throw invalid('conviction must be between 1 and 10')
        return v
      }
      case 'trend': {
        if (v === null) return null
        if (typeof v !== 'object' || Array.isArray(v)) throw invalid('trend answer must be an object')
        const map = v as Record<string, { trend?: string | null; note?: string | null } | null>
        const out: Record<string, { trend: TrendValue | null; note: string | null }> = {}
        for (const tf of TIMEFRAMES) {
          const e = map[tf]
          if (!e) continue
          if (e.trend != null && !(TRENDS as string[]).includes(e.trend)) throw invalid(`unknown trend for ${tf}`)
          const note = text(e.note, 'trend note', 500)
          const trend = (e.trend ?? null) as TrendValue | null
          if (trend || note) out[tf] = { trend, note }
        }
        const bad = Object.keys(map).find((k) => !(TIMEFRAMES as readonly string[]).includes(k))
        if (bad) throw invalid(`unknown time frame "${bad}"`)
        return Object.keys(out).length ? out : null
      }
      case 'setups': {
        const ids = tagIds(v, 'setup', 30, 'setups')
        return ids.length ? ids : null
      }
      case 'emotions': {
        if (v === null) return null
        const o = v as { text?: string | null; tagIds?: number[] }
        const note = text(o.text, 'state', 300)
        const ids = tagIds(o.tagIds, 'emotion', 30, 'emotions')
        return note || ids.length ? { text: note, tagIds: ids } : null
      }
      case 'news': {
        if (v === null) return null
        const note = text((v as { note?: string | null }).note, 'news note', 1000)
        return note ? { note } : null
      }
    }
  }
  function writeAnswers(a: Analysis, answers: AnalysisInput['answers']) {
    for (const input of answers) {
      const q = questionOf(input.questionId)
      const value = normalize(q, input.value)
      const at = a.answers.findIndex((x) => x.questionId === q.id)
      if (value === null) {
        if (at >= 0) a.answers.splice(at, 1)
      } else if (q.archived && at < 0) {
        throw invalid(`question ${q.key} is archived`)
      } else if (at >= 0) a.answers[at] = { questionId: q.id, value }
      else a.answers.push({ questionId: q.id, value })
    }
    const pos = new Map(questions.map((q) => [q.id, q.position]))
    a.answers.sort((x, y) => (pos.get(x.questionId) ?? 0) - (pos.get(y.questionId) ?? 0) || x.questionId - y.questionId)
    return a.answers.length
  }
  const checkTz = (tz: number) => {
    if (tz < -14 * 60 || tz > 14 * 60) throw invalid('the time zone offset is out of range')
  }

  // --- idées -----------------------------------------------------------------------------------
  const money = (field: string, s: string | null): string | null => {
    const t = (s ?? '').trim()
    if (!t) return null
    if (!/^-?\d+(\.\d+)?$/.test(t)) throw invalid(`${field} is not a valid decimal number: "${t}"`)
    if (!/[1-9]/.test(t) || t.startsWith('-')) throw invalid(`${field} must be greater than zero`)
    return t
  }
  const scaled = (s: string) => {
    const [i, f = ''] = s.split('.')
    return BigInt(i + f.padEnd(12, '0').slice(0, 12))
  }
  function cleanIdea(input: IdeaInput) {
    if (!deps.instruments().some((i) => i.id === input.instrumentId)) throw notFound(`instrument ${input.instrumentId}`)
    const bad = input.timeframes.find((t) => !(TIMEFRAMES as readonly string[]).includes(t))
    if (bad) throw invalid(`unknown time frame "${bad}"`)
    const timeframes = TIMEFRAMES.filter((t) => input.timeframes.includes(t)) as Timeframe[]
    const note = optText('note', input.note, 4000)
    if (!note) throw invalid('the note is required')
    const low = money('low level', input.levelLow)
    const high = money('high level', input.levelHigh)
    if (low && high && scaled(low) > scaled(high)) throw invalid('the low level must not be above the high level')
    return { timeframes, note, low, high, invalidation: optText('invalidation', input.invalidation, 2000) }
  }
  const addNote = (idea: Idea, at: number, kind: IdeaNote['kind'], body: string, data: string | null = null) =>
    idea.notes.push({ id: nextNoteId++, createdAt: at, kind, body, data })
  const symbolOf = (instrumentId: number) => deps.instruments().find((i) => i.id === instrumentId)?.symbol ?? ''
  const ideaOf = (id: number) => {
    const i = ideas.get(id)
    if (!i) throw notFound(`idea ${id}`)
    i.symbol = symbolOf(i.instrumentId)
    return i
  }
  const activeIdea = (id: number) => {
    const i = ideaOf(id)
    if (i.status !== 'active') throw invalid('the idea is closed')
    return i
  }

  const settingsNow = (): AnalysisSettings => {
    const raw = Number(settings.get('analysis.stale_days'))
    const ok = Number.isInteger(raw) && raw >= MIN_STALE_DAYS && raw <= MAX_STALE_DAYS
    return { staleDays: ok ? raw : DEFAULT_STALE_DAYS, noAnalysisAlert: settings.get('alerts.no_analysis') === 'on' }
  }

  /** Ce que les règles de la revue disent de l'idée au jour local `today` (miroir de `ideas::view`). */
  function view(idea: Idea, now: number, tz: number): IdeaView {
    const s = settingsNow()
    const today = dayOf(now, tz)
    const active = idea.status === 'active'
    const ageDays = localDayNumber(now, tz) - localDayNumber(idea.updatedAt, tz)
    const snoozed = active && idea.snoozedUntilDay !== null && idea.snoozedUntilDay > today
    const returned = active && idea.snoozedUntilDay !== null && idea.snoozedUntilDay <= today
    const stale = active && !snoozed && ageDays >= s.staleDays
    const reviewedToday = idea.lastReviewedAt !== null && dayOf(idea.lastReviewedAt, tz) === today
    const inReview = active && !snoozed && !reviewedToday && ageDays >= 1
    return { ...structuredClone({ ...idea, symbol: symbolOf(idea.instrumentId) }), ageDays, stale, snoozed, returned, reviewedToday, inReview }
  }
  const views = (status: IdeaStatus, instrumentId: number | null, now: number, tz: number) =>
    [...ideas.values()]
      .filter((i) => i.status === status && (instrumentId === null || i.instrumentId === instrumentId))
      .sort(status === 'active' ? (a, b) => a.updatedAt - b.updatedAt || a.id - b.id : (a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0) || b.id - a.id)
      .map((i) => view(i, now, tz))

  function queue(now: number, tz: number): ReviewQueue {
    const items = views('active', null, now, tz).filter((v) => v.inReview)
    items.sort((a, b) => Number(!a.returned) - Number(!b.returned) || Number(!a.stale) - Number(!b.stale) || a.updatedAt - b.updatedAt || a.id - b.id)
    const visible = Math.min(items.length, REVIEW_VISIBLE)
    return { day: dayOf(now, tz), items, visible, hidden: items.length - visible }
  }
  const dismissBanner = (now: number, tz: number) => void settings.set('analysis.last_review_day', dayOf(now, tz))
  const settle = (now: number, tz: number) => {
    if (queue(now, tz).items.length === 0) dismissBanner(now, tz)
  }

  function complete(id: number, body: string, now: number) {
    const idea = activeIdea(id)
    const text = optText('note', body, 4000)
    if (!text) throw invalid('the note is required')
    addNote(idea, now, 'complement', text)
    idea.updatedAt = now
    idea.lastReviewedAt = now
    idea.snoozedUntilDay = null
    return idea
  }
  function close(id: number, outcome: IdeaOutcome, reason: string | null, now: number) {
    const idea = activeIdea(id)
    addNote(idea, now, 'closed', optText('reason', reason, 500) ?? '', outcome)
    Object.assign(idea, { status: 'closed', outcome, closedAt: now, lastReviewedAt: now, snoozedUntilDay: null })
    return idea
  }

  function outcomes(from: number | null, to: number | null): IdeaOutcomes {
    const closed = [...ideas.values()].filter((i) => i.status === 'closed' && (from === null || i.closedAt! >= from) && (to === null || i.closedAt! < to))
    const count = (o: IdeaOutcome) => closed.filter((i) => i.outcome === o).length
    const [worked, invalidated, noFollowUp] = [count('worked'), count('invalidated'), count('noFollowUp')]
    const closedCount = worked + invalidated + noFollowUp
    return {
      worked, invalidated, noFollowUp, closedCount,
      successRate: closedCount >= MIN_SAMPLE && worked + invalidated > 0 ? worked / (worked + invalidated) : null,
      activeCount: [...ideas.values()].filter((i) => i.status === 'active').length,
    }
  }

  return {
    // --- questions
    getAnalysisQuestions: async (includeArchived: boolean): Promise<Question[]> =>
      structuredClone(sortedQuestions().filter((q) => includeArchived || !q.archived)),
    addAnalysisQuestion: async (label: string, kind: QuestionKind, options: Question['options']): Promise<Question> => {
      if (kind === 'news') throw invalid('the economic news block already exists')
      const text = optText('label', squeeze(label), 200)
      if (!text) throw invalid('label is required')
      const q: Question = { id: nextQuestionId++, key: '', label: text, kind, position: Math.max(0, ...questions.map((x) => x.position)) + 1, archived: false, options: cleanOptions(kind, options) }
      q.key = `custom_${q.id}`
      questions.push(q)
      return structuredClone(q)
    },
    updateAnalysisQuestion: async (id: number, label: string | null, options: Question['options'] | null): Promise<Question> => {
      const q = questionOf(id)
      const original = !q.key.startsWith('custom_')
      const text = optText('label', label === null ? null : squeeze(label), 200)
      if (text === null && !original) throw invalid('label is required')
      const nextOptions = options === null ? q.options : cleanOptions(q.kind, options)
      q.label = text
      q.options = nextOptions
      return structuredClone(q)
    },
    moveAnalysisQuestion: async (id: number, delta: number): Promise<Question[]> => {
      const shown = sortedQuestions().filter((q) => !q.archived)
      const at = shown.findIndex((q) => q.id === id)
      if (at < 0) {
        questionOf(id)
        throw invalid('an archived question cannot be moved')
      }
      const to = Math.min(Math.max(at + Math.sign(delta), 0), shown.length - 1)
      if (to !== at) [shown[at].position, shown[to].position] = [shown[to].position, shown[at].position]
      return structuredClone(sortedQuestions())
    },
    setAnalysisQuestionArchived: async (id: number, archived: boolean): Promise<Question> => {
      const q = questionOf(id)
      q.archived = archived
      return structuredClone(q)
    },

    // --- analyses de séance
    createAnalysis: async (input: AnalysisInput, now = deps.now()): Promise<Analysis> => {
      checkTz(input.tzOffsetMin)
      const note = optText('note', input.note, 2000)
      const createdAt = input.createdAt ?? now
      const a: Analysis = { id: nextAnalysisId, createdAt, tzOffsetMin: input.tzOffsetMin, day: dayOf(createdAt, input.tzOffsetMin), updatedAt: now, note, answers: [] }
      if (writeAnswers(a, input.answers) === 0) throw invalid('an empty analysis is not saved')
      nextAnalysisId++
      analyses.set(a.id, a)
      return structuredClone(a)
    },
    updateAnalysis: async (id: number, input: AnalysisInput, now = deps.now()): Promise<Analysis> => {
      const current = analyses.get(id)
      if (!current) throw notFound(`analysis ${id}`)
      checkTz(input.tzOffsetMin)
      const next = structuredClone(current)
      next.note = optText('note', input.note, 2000)
      next.createdAt = input.createdAt ?? current.createdAt
      next.tzOffsetMin = input.tzOffsetMin
      next.day = dayOf(next.createdAt, next.tzOffsetMin)
      next.updatedAt = now
      if (writeAnswers(next, input.answers) === 0) throw invalid('an empty analysis is not saved')
      analyses.set(id, next)
      return structuredClone(next)
    },
    deleteAnalysis: async (id: number): Promise<void> => {
      if (!analyses.delete(id)) throw notFound(`analysis ${id}`)
      for (const set of tradeAnalyses.values()) set.delete(id)
    },
    listAnalysesOfDay: async (day: string): Promise<Analysis[]> => {
      checkDay('day', day)
      return structuredClone([...analyses.values()].filter((a) => a.day === day).sort((a, b) => a.createdAt - b.createdAt || a.id - b.id))
    },
    listAnalysesBefore: async (day: string, limit: number): Promise<Analysis[]> => {
      checkDay('day', day)
      return structuredClone(
        [...analyses.values()]
          .filter((a) => a.day < day)
          .sort((a, b) => (a.day === b.day ? b.createdAt - a.createdAt || b.id - a.id : a.day < b.day ? 1 : -1))
          .slice(0, Math.min(limit, 500)),
      )
    },
    getNewsBlock: async (day: string | null, now = deps.now()): Promise<NewsBlock> => {
      const parisDay = day ?? new Date(now + parisOffset(now) * 60_000).toISOString().slice(0, 10)
      if (day !== null) checkDay('day', day)
      if (!deps.news.enabled()) return { state: 'off', day: parisDay, events: [] }
      const events = deps.news.eventsOfDay(parisDay).filter((e) => e.importance === 'high').map((e) => ({ id: e.id, title: e.title, currency: e.currency, parisTime: e.parisTime }))
      return { state: events.length ? 'events' : 'none', day: parisDay, events }
    },

    // --- idées
    createIdea: async (input: IdeaInput, now = deps.now()): Promise<Idea> => {
      const c = cleanIdea(input)
      const idea: Idea = {
        id: nextIdeaId++, instrumentId: input.instrumentId, symbol: symbolOf(input.instrumentId), timeframes: c.timeframes, note: c.note,
        levelLow: c.low, levelHigh: c.high, invalidation: c.invalidation, createdAt: now, updatedAt: now, lastReviewedAt: null,
        status: 'active', outcome: null, closedAt: null, snoozedUntilDay: null, snoozeCount: 0, notes: [],
      }
      addNote(idea, now, 'created', c.note)
      ideas.set(idea.id, idea)
      return structuredClone(idea)
    },
    updateIdea: async (id: number, input: IdeaInput, now = deps.now()): Promise<Idea> => {
      const old = activeIdea(id)
      const c = cleanIdea(input)
      const changed =
        old.instrumentId !== input.instrumentId || old.timeframes.join() !== c.timeframes.join() || old.note !== c.note ||
        old.levelLow !== c.low || old.levelHigh !== c.high || old.invalidation !== c.invalidation
      if (!changed) return structuredClone(old)
      if (old.note !== c.note) addNote(old, now, 'edit', c.note)
      Object.assign(old, { instrumentId: input.instrumentId, timeframes: c.timeframes, note: c.note, levelLow: c.low, levelHigh: c.high, invalidation: c.invalidation, updatedAt: now, snoozedUntilDay: null })
      return structuredClone(ideaOf(id))
    },
    listIdeas: async (status: IdeaStatus, instrumentId: number | null, tz: number, now = deps.now()): Promise<IdeaView[]> => views(status, instrumentId, now, tz),

    // --- revue du matin
    getReviewQueue: async (tz: number, now = deps.now()): Promise<ReviewQueue> => queue(now, tz),
    getReviewBanner: async (tz: number, now = deps.now()): Promise<ReviewBanner | null> => {
      const day = dayOf(now, tz)
      if (settings.get('analysis.last_review_day') === day) return null
      const count = queue(now, tz).items.length
      return count > 0 ? { day, count } : null
    },
    dismissReviewBanner: async (tz: number, now = deps.now()): Promise<void> => dismissBanner(now, tz),
    ideaKeep: async (id: number, tz: number, now = deps.now()): Promise<IdeaView> => {
      const idea = activeIdea(id)
      idea.lastReviewedAt = now
      idea.snoozedUntilDay = null
      settle(now, tz)
      return view(idea, now, tz)
    },
    ideaComplete: async (id: number, body: string, tz: number, now = deps.now()): Promise<IdeaView> => {
      const idea = complete(id, body, now)
      settle(now, tz)
      return view(idea, now, tz)
    },
    ideaClose: async (id: number, outcome: IdeaOutcome, reason: string | null, tz: number, now = deps.now()): Promise<IdeaView> => {
      const idea = close(id, outcome, reason, now)
      settle(now, tz)
      return view(idea, now, tz)
    },
    ideaDelete: async (id: number, tz: number, now = deps.now()): Promise<void> => {
      ideaOf(id)
      ideas.delete(id)
      for (const set of tradeIdeas.values()) set.delete(id)
      settle(now, tz)
    },
    ideaSnooze: async (id: number, days: number, tz: number, now = deps.now()): Promise<IdeaView> => {
      if (!Number.isInteger(days) || days < MIN_SNOOZE_DAYS || days > MAX_SNOOZE_DAYS) throw invalid(`the delay must be between ${MIN_SNOOZE_DAYS} and ${MAX_SNOOZE_DAYS} days`)
      const idea = activeIdea(id)
      const until = dayKeyOfNumber(localDayNumber(now, tz) + days)
      idea.snoozedUntilDay = until
      idea.snoozeCount += 1
      idea.lastReviewedAt = now
      addNote(idea, now, 'snooze', '', until)
      settle(now, tz)
      return view(idea, now, tz)
    },

    // --- réglages
    getAnalysisSettings: async (): Promise<AnalysisSettings> => settingsNow(),
    setAnalysisSettings: async (s: AnalysisSettings): Promise<AnalysisSettings> => {
      if (!Number.isInteger(s.staleDays) || s.staleDays < MIN_STALE_DAYS || s.staleDays > MAX_STALE_DAYS) {
        throw invalid(`the number of days must be between ${MIN_STALE_DAYS} and ${MAX_STALE_DAYS}`)
      }
      settings.set('analysis.stale_days', String(s.staleDays))
      settings.set('alerts.no_analysis', s.noAnalysisAlert ? 'on' : 'off')
      return settingsNow()
    },

    // --- liens avec les trades
    getTradeLinks: async (tradeId: number): Promise<TradeLinks> => linksOf(tradeId),
    setTradeLinks: async (tradeId: number, ideaIds: number[], analysisIds: number[]): Promise<TradeLinks> => {
      if (!deps.tradeExists(tradeId)) throw notFound(`trade ${tradeId}`)
      const badIdea = ideaIds.find((i) => !ideas.has(i))
      if (badIdea !== undefined) throw notFound(`idea ${badIdea}`)
      const badAnalysis = analysisIds.find((a) => !analyses.has(a))
      if (badAnalysis !== undefined) throw notFound(`analysis ${badAnalysis}`)
      tradeIdeas.set(tradeId, new Set(ideaIds))
      tradeAnalyses.set(tradeId, new Set(analysisIds))
      return linksOf(tradeId)
    },
    /** Appelé quand un trade est supprimé : ses liens partent, jamais l'idée ni l'analyse. */
    dropTradeLinks: (tradeId: number) => {
      tradeIdeas.delete(tradeId)
      tradeAnalyses.delete(tradeId)
    },

    // --- constat
    getAnalysisReport: async (q: StatsQuery): Promise<AnalysisReport> => {
      const linked = new Set<number>()
      for (const [trade, set] of tradeIdeas) if (set.size) linked.add(trade)
      for (const [trade, set] of tradeAnalyses) if (set.size) linked.add(trade)
      return {
        ideas: outcomes(q.from ?? null, q.to ?? null),
        comparison: deps.comparison(q, linked),
        analysisCount: [...analyses.values()].filter((a) => (q.from == null || a.createdAt >= q.from) && (q.to == null || a.createdAt < q.to)).length,
      }
    },
    /** Pour le widget et les tests : résultats des idées sans passer par le constat complet. */
    ideaOutcomes: outcomes,

    // --- alerte facultative « sans analyse » (miroir de `alerts::no_analysis`)
    noAnalysisEnabled: (): boolean => settingsNow().noAnalysisAlert,
    noAnalysisStamps: (day: string): number[] => [...analyses.values()].filter((a) => a.day === day).map((a) => a.createdAt).sort((a, b) => a - b),
  }

  function linksOf(tradeId: number): TradeLinks {
    return {
      ideas: [...(tradeIdeas.get(tradeId) ?? [])].filter((i) => ideas.has(i)).sort((a, b) => a - b).map((i) => {
        const idea = ideaOf(i)
        return { id: i, symbol: idea.symbol, note: idea.note, status: idea.status, outcome: idea.outcome }
      }),
      analyses: [...(tradeAnalyses.get(tradeId) ?? [])]
        .filter((a) => analyses.has(a))
        .map((a) => analyses.get(a)!)
        .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id)
        .map((a) => ({ id: a.id, createdAt: a.createdAt, tzOffsetMin: a.tzOffsetMin, day: a.day })),
    }
  }
}

// Décalage de Paris (règle de l'UE) : celui de `mockNews`, recopié pour ne pas lier les deux modules.
import { parisOffsetMin } from './mockNews'
const parisOffset = (utc: number) => parisOffsetMin(utc)

export type AnalysisMock = ReturnType<typeof createAnalysisMock>

/** Évalue l'alerte « sans analyse » (miroir de `alerts/no_analysis.rs`) : fonction pure. */
export function noAnalysisAlerts(
  trades: { id: number; accountId: number; entryTime: number; tzOffsetMin: number }[],
  stamps: number[],
  now: number,
  tz: number,
  enabled: boolean,
): { id: string; accountId: number; tradeId: number; at: number; day: string }[] {
  if (!enabled) return []
  const today = localDayNumber(now, tz)
  return trades
    .filter((t) => t.entryTime <= now && localDayNumber(t.entryTime, t.tzOffsetMin) === today)
    .sort((a, b) => a.entryTime - b.entryTime || a.id - b.id)
    .filter((t) => !stamps.some((s) => s <= t.entryTime))
    .map((t) => ({ id: `noAnalysis:${t.accountId}:${t.id}`, accountId: t.accountId, tradeId: t.id, at: t.entryTime, day: dayKeyOfNumber(today) }))
}
