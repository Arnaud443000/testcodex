import type {
  Backtest,
  BacktestCase,
  BacktestCurvePoint,
  BacktestData,
  BacktestListItem,
  BacktestReport,
  CaseData,
  PerfSummary,
  ReportOptions,
  Scenario,
  TpScenarios,
} from '../types/backtest'
import { MIN_SAMPLE } from '../types/backtest'

/**
 * MOCK des backtests — uniquement pour `npm run dev` dans un navigateur.
 * Il reproduit les règles de `pulse-core/src/backtests.rs` (validation, performance en R, simulation
 * du TP) et est testé contre le même journal « B », calculé à la main. Il ne fait pas foi : dans
 * l'application, tout vient de pulse-core. Une différence connue : pas de comparaison avec les vrais
 * trades (`real` vaut toujours `null`) ni de contrôle du type du tag lié.
 */

export const TP_LEVELS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5]
const MAX_R = 1000

const invalid = (m: string) => new Error(`invalid input: ${m}`)
const num = (s: string | null) => (s === null ? null : Number(s))
const mean = (sum: number, n: number) => (n > 0 ? sum / n : null)

const clean = (s: string) => s.trim()
const cleanName = (s: string) => s.split(/\s+/).filter(Boolean).join(' ')

export function validateCase(d: CaseData): CaseData {
  if (d.tzOffsetMin < -840 || d.tzOffsetMin > 840) throw invalid('time zone offset must be between -14:00 and +14:00')
  for (const [field, v] of [['planned R:R', d.plannedRr], ['result R', d.resultR], ['max R', d.maxR]] as const) {
    if (v !== null && Math.abs(Number(v)) > MAX_R) throw invalid(`${field} must be between -${MAX_R} and ${MAX_R}`)
  }
  if (d.plannedRr !== null && !(Number(d.plannedRr) > 0)) throw invalid('planned R:R must be greater than zero')
  if (d.maxR !== null && Number(d.maxR) < 0) throw invalid('max R cannot be negative (0 = the price never went in favour)')
  const out = { ...d, notes: clean(d.notes) }
  if (d.outcome === 'no_entry') return { ...out, resultR: null, maxR: null }
  if (d.resultR === null) throw invalid('the result in R is required once the trade was entered')
  const r = Number(d.resultR)
  if (d.outcome === 'tp' && r <= 0) throw invalid('a take-profit hit must have a positive result')
  if (d.outcome === 'sl' && r > 0) throw invalid('a stop-loss hit cannot have a positive result')
  if (d.maxR !== null && Number(d.maxR) < r) throw invalid('max R cannot be below the result: the price went at least that far')
  return out
}

/** « Et si le TP avait été à X R ? » sur des paires (résultat, max R) — même règle que `backtests::scenarios`. */
export function scenarios(pairs: [number, number | null][]): TpScenarios {
  const usable = pairs.filter((p): p is [number, number] => p[1] !== null)
  const n = usable.length
  const actual = usable.reduce((a, [r]) => a + r, 0)
  const levels: Scenario[] = TP_LEVELS.map((tp) => {
    const sim = usable.map(([r, m]) => (m >= tp ? tp : r))
    const total = sim.reduce((a, v) => a + v, 0)
    return {
      tpR: tp,
      reachedCount: usable.filter(([, m]) => m >= tp).length,
      winRate: mean(sim.filter((v) => v > 0).length, n),
      expectancyR: mean(total, n),
      totalR: total,
      differenceR: total - actual,
    }
  })
  const lowSample = n < MIN_SAMPLE
  let best: Scenario | null = null
  if (!lowSample) for (const s of levels) if (best === null || s.totalR > best.totalR + 1e-9) best = s
  return {
    sampleCount: n,
    missingMaxRCount: pairs.length - n,
    lowSample,
    actualTotalR: actual,
    actualExpectancyR: mean(actual, n),
    actualWinRate: mean(usable.filter(([r]) => r > 0).length, n),
    levels,
    bestTpR: best?.tpR ?? null,
  }
}

function summarize(taken: BacktestCase[]): PerfSummary {
  const results = taken.map((c) => Number(c.resultR))
  const wins = results.filter((r) => r > 0)
  const losses = results.filter((r) => r < 0)
  const total = results.reduce((a, r) => a + r, 0)
  const gains = wins.reduce((a, r) => a + r, 0)
  const lost = -losses.reduce((a, r) => a + r, 0)
  const planned = taken.map((c) => num(c.plannedRr)).filter((v): v is number => v !== null)
  const maxes = taken.map((c) => num(c.maxR)).filter((v): v is number => v !== null)
  let peak = 0
  let run = 0
  let drawdown = 0
  for (const r of results) {
    run += r
    peak = Math.max(peak, run)
    drawdown = Math.max(drawdown, peak - run)
  }
  const n = taken.length
  return {
    tradeCount: n,
    winCount: wins.length,
    lossCount: losses.length,
    breakevenCount: n - wins.length - losses.length,
    winRate: mean(wins.length, n),
    expectancyR: mean(total, n),
    totalR: total,
    avgWinR: mean(gains, wins.length),
    avgLossR: mean(lost, losses.length),
    profitFactor: lost > 0 ? gains / lost : null,
    avgPlannedRr: mean(planned.reduce((a, v) => a + v, 0), planned.length),
    avgMaxR: mean(maxes.reduce((a, v) => a + v, 0), maxes.length),
    maxDrawdownR: drawdown,
    lowSample: n < MIN_SAMPLE,
  }
}

export function buildReport(backtestId: number, cases: BacktestCase[], options: ReportOptions): BacktestReport {
  const count = (v: string) => cases.filter((c) => c.setupValid === v).length
  const yes = count('yes')
  const no = count('no')
  const counts = (c: BacktestCase) => c.setupValid === 'yes' || (c.setupValid === 'doubtful' && options.includeDoubtful)
  const taken = cases
    .filter((c) => counts(c) && c.outcome !== 'no_entry' && c.resultR !== null)
    .sort((a, b) => a.occurredAt - b.occurredAt || a.id - b.id)
  let cumulative = 0
  const curve: BacktestCurvePoint[] = taken.map((c) => {
    cumulative += Number(c.resultR)
    return { caseId: c.id, occurredAt: c.occurredAt, resultR: Number(c.resultR), cumulativeR: cumulative }
  })
  return {
    backtestId,
    caseCount: cases.length,
    validity: { yes, no, doubtful: count('doubtful'), rate: yes + no > 0 ? yes / (yes + no) : null },
    noEntryCount: cases.filter((c) => c.setupValid === 'yes' && c.outcome === 'no_entry').length,
    overall: summarize(taken),
    past: summarize(taken.filter((c) => c.observation === 'past')),
    live: summarize(taken.filter((c) => c.observation === 'live')),
    long: summarize(taken.filter((c) => c.direction === 'long')),
    short: summarize(taken.filter((c) => c.direction === 'short')),
    curve,
    scenarios: scenarios(taken.map((c): [number, number | null] => [Number(c.resultR), num(c.maxR)])),
    real: null,
  }
}

export function createBacktestsMock() {
  const sessions: Backtest[] = []
  const cases: BacktestCase[] = []
  let nextId = 1
  let nextCaseId = 1

  const find = (id: number) => {
    const b = sessions.find((s) => s.id === id)
    if (!b) throw new Error(`not found: backtest ${id}`)
    return b
  }
  const findCase = (id: number) => {
    const c = cases.find((x) => x.id === id)
    if (!c) throw new Error(`not found: backtest case ${id}`)
    return c
  }
  const sorted = (backtestId: number) => cases.filter((c) => c.backtestId === backtestId).sort((a, b) => a.occurredAt - b.occurredAt || a.id - b.id)

  function check(d: BacktestData, ownId: number | null): BacktestData {
    const name = cleanName(d.name)
    if (!name) throw invalid('name is required')
    if (name.length > 80) throw invalid('name must be at most 80 characters')
    if (sessions.some((s) => s.id !== ownId && s.name.toLowerCase() === name.toLowerCase())) throw invalid(`a backtest named "${name}" already exists`)
    return {
      ...d,
      name,
      asset: clean(d.asset),
      timeframe: clean(d.timeframe),
      entryConditions: clean(d.entryConditions),
      exitRules: clean(d.exitRules),
      notes: clean(d.notes),
    }
  }

  return {
    async listBacktests(): Promise<BacktestListItem[]> {
      return [...sessions]
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id - b.id)
        .map((b) => {
          const r = buildReport(b.id, sorted(b.id), { includeDoubtful: false })
          return { ...b, caseCount: r.caseCount, validityRate: r.validity.rate, overall: r.overall }
        })
    },
    async createBacktest(d: BacktestData): Promise<Backtest> {
      const b: Backtest = { ...check(d, null), id: nextId++ }
      sessions.push(b)
      return { ...b }
    },
    async updateBacktest(id: number, d: BacktestData): Promise<Backtest> {
      const b = find(id)
      Object.assign(b, check(d, id))
      return { ...b }
    },
    async deleteBacktest(id: number): Promise<void> {
      find(id)
      sessions.splice(sessions.findIndex((s) => s.id === id), 1)
      for (let i = cases.length - 1; i >= 0; i--) if (cases[i].backtestId === id) cases.splice(i, 1)
    },
    async listBacktestCases(backtestId: number): Promise<BacktestCase[]> {
      find(backtestId)
      return sorted(backtestId).map((c) => ({ ...c }))
    },
    async addBacktestCase(backtestId: number, d: CaseData): Promise<BacktestCase> {
      find(backtestId)
      const c: BacktestCase = { ...validateCase(d), id: nextCaseId++, backtestId }
      cases.push(c)
      return { ...c }
    },
    async updateBacktestCase(id: number, d: CaseData): Promise<BacktestCase> {
      const c = findCase(id)
      Object.assign(c, validateCase(d))
      return { ...c }
    },
    async deleteBacktestCase(id: number): Promise<void> {
      findCase(id)
      cases.splice(cases.findIndex((c) => c.id === id), 1)
    },
    async getBacktestReport(backtestId: number, options?: ReportOptions): Promise<BacktestReport> {
      find(backtestId)
      return buildReport(backtestId, sorted(backtestId), options ?? { includeDoubtful: false })
    },
  }
}
