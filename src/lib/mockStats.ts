import type { Decimal } from '../types/money'
import type { Direction, Outcome } from '../types/trade'
import type {
  Calendar,
  CalendarQuery,
  Comparison,
  Dashboard,
  DashboardQuery,
  DayResult,
  DayTrade,
  EquityPoint,
  Report,
  Sparklines,
  Summary,
} from '../types/stats'

/**
 * MOCK des statistiques — uniquement pour `npm run dev` dans un navigateur.
 * Il reproduit la forme des réponses de pulse-core (crates/pulse-core/src/stats)
 * sur des cas simples pour pouvoir développer et capturer l'interface sans Rust.
 * Il ne fait pas foi : dans l'application, tous les chiffres viennent de pulse-core.
 * Les montants sont sommés en entiers exacts (BigInt, 8 décimales), jamais en flottants.
 */

const SCALE = 8
const ONE = 10n ** BigInt(SCALE)
const DAY = 86_400_000

export const toScaled = (v: Decimal): bigint => {
  const neg = v.startsWith('-')
  const [i, f = ''] = (neg ? v.slice(1) : v).split('.')
  const n = BigInt(i + f.padEnd(SCALE, '0').slice(0, SCALE))
  return neg ? -n : n
}
export const toDec = (n: bigint): Decimal => {
  const neg = n < 0n
  const digits = (neg ? -n : n).toString().padStart(SCALE + 1, '0')
  const frac = digits.slice(-SCALE).replace(/0+$/, '')
  return `${neg ? '-' : ''}${digits.slice(0, -SCALE)}${frac ? `.${frac}` : ''}`
}
const asNumber = (n: bigint): number => Number(n) / Number(ONE)
export const ratio = (a: bigint, b: bigint): number | null => (b === 0n ? null : Number((a * ONE) / b) / Number(ONE))

export interface MockClosed {
  id: number
  symbol: string
  direction: Direction
  exitTime: number
  tzOffsetMin: number
  netPnl: Decimal
  rMultiple: number | null
  outcome: Outcome
}

export interface MockLedger {
  currency: string | null
  initialCapital: Decimal
  /** Dépôts (+) et retraits (−) : jamais de la performance. */
  capitalMoves: { at: number; amount: Decimal }[]
  closed: MockClosed[]
  openCount: number
}

export const dayKey = (ms: number, tz: number) => new Date(ms + tz * 60_000).toISOString().slice(0, 10)
export const localDay = (ms: number, tz: number) => Math.floor((ms + tz * 60_000) / DAY)

export function summarize(set: MockClosed[]): Summary {
  let gross = 0n
  let gains = 0n
  let losses = 0n
  let wins = 0
  let lossCount = 0
  let flat = 0
  let peak = 0n
  let cum = 0n
  let maxDd = 0n
  for (const c of set) {
    const n = toScaled(c.netPnl)
    gross += n
    cum += n
    peak = cum > peak ? cum : peak
    if (peak - cum > maxDd) maxDd = peak - cum
    if (c.outcome === 'win') {
      wins++
      gains += n
    } else if (c.outcome === 'loss') {
      lossCount++
      losses -= n
    } else flat++
  }
  const n = set.length
  const rs = set.map((c) => c.rMultiple).filter((r): r is number => r !== null)
  const winsR = rs.filter((r) => r > 0)
  const lossesR = rs.filter((r) => r < 0).map(Math.abs)
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0)
  const expectancyR = rs.length ? (winsR.length / rs.length) * mean(winsR) - (lossesR.length / rs.length) * mean(lossesR) : null
  const avg = (total: bigint, count: number) => (count ? toDec(total / BigInt(count)) : null)
  const avgWin = wins ? gains / BigInt(wins) : null
  const avgLoss = lossCount ? losses / BigInt(lossCount) : null
  return {
    tradeCount: n,
    winCount: wins,
    lossCount,
    breakevenCount: flat,
    grossPnl: toDec(gross),
    fees: '0',
    netPnl: toDec(gross),
    totalGains: toDec(gains),
    totalLosses: toDec(losses),
    returnPct: null,
    winRate: n ? wins / n : null,
    avgWin: avgWin === null ? null : toDec(avgWin),
    avgLoss: avgLoss === null ? null : toDec(avgLoss),
    avgWinLossRatio: avgWin !== null && avgLoss !== null ? ratio(avgWin, avgLoss) : null,
    profitFactor: ratio(gains, losses),
    expectancyR,
    rTradeCount: rs.length,
    avgNetPnl: avg(gross, n),
    sharpe: null,
    maxDrawdown: toDec(maxDd),
    maxDrawdownPct: null,
    currentDrawdown: toDec(peak - cum),
    currentDrawdownPct: null,
  }
}

function daily(set: MockClosed[]): DayResult[] {
  const days = new Map<string, DayResult>()
  for (const c of set) {
    const key = dayKey(c.exitTime, c.tzOffsetMin)
    const d = days.get(key) ?? { day: key, netPnl: '0', tradeCount: 0, winCount: 0, lossCount: 0 }
    d.netPnl = toDec(toScaled(d.netPnl) + toScaled(c.netPnl))
    d.tradeCount++
    if (c.outcome === 'win') d.winCount++
    if (c.outcome === 'loss') d.lossCount++
    days.set(key, d)
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day))
}

function report(ledger: MockLedger, from: number | null, to: number | null): Report {
  const sorted = [...ledger.closed].sort((a, b) => a.exitTime - b.exitTime || a.id - b.id)
  const set = sorted.filter((c) => (from === null || c.exitTime >= from) && (to === null || c.exitTime < to))
  let cum = 0n
  let peak = 0n
  const curve: EquityPoint[] = set.map((c) => {
    cum += toScaled(c.netPnl)
    peak = cum > peak ? cum : peak
    return { tradeId: c.id, time: c.exitTime, cumulativeNetPnl: toDec(cum), growth: null, drawdown: toDec(peak - cum), drawdownPct: null }
  })
  const flows = ledger.capitalMoves.reduce((a, m) => a + toScaled(m.amount), 0n)
  const deposits = ledger.capitalMoves.filter((m) => toScaled(m.amount) > 0n).reduce((a, m) => a + toScaled(m.amount), 0n)
  const allPnl = sorted.reduce((a, c) => a + toScaled(c.netPnl), 0n)
  return {
    currency: ledger.currency,
    initialCapital: ledger.initialCapital,
    totalDeposits: toDec(deposits),
    totalWithdrawals: toDec(deposits - flows),
    currentCapital: toDec(toScaled(ledger.initialCapital) + flows + allPnl),
    openTradeCount: ledger.openCount,
    summary: summarize(set),
    equityCurve: curve,
    daily: daily(set),
  }
}

const PERIOD_DAYS = { day: 1, week: 7, month: 30, quarter: 90, year: 365, all: null } as const

export function mockDashboard(ledger: MockLedger, q: DashboardQuery): Dashboard {
  const n = PERIOD_DAYS[q.period]
  let from: number | null = null
  let to: number | null = null
  let previousFrom: number | null = null
  if (n !== null) {
    const midnight = (day: number) => day * DAY - q.tzOffsetMin * 60_000
    const today = localDay(q.nowMs, q.tzOffsetMin)
    to = midnight(today + 1)
    from = midnight(today + 1 - n)
    previousFrom = midnight(today + 1 - 2 * n)
  }
  const current = report(ledger, from, to)
  const previous = n === null ? null : report(ledger, previousFrom, from).summary
  const s = current.summary
  const diff = (a: number | null, b: number | null) => (a !== null && b !== null ? a - b : null)
  const comparison: Comparison | null = previous
    ? {
        tradeCount: s.tradeCount - previous.tradeCount,
        netPnl: toDec(toScaled(s.netPnl) - toScaled(previous.netPnl)),
        netPnlPct: ratio(toScaled(s.netPnl) - toScaled(previous.netPnl), toScaled(previous.netPnl) < 0n ? -toScaled(previous.netPnl) : toScaled(previous.netPnl)),
        winRate: diff(s.winRate, previous.winRate),
        profitFactor: diff(s.profitFactor, previous.profitFactor),
        avgWinLossRatio: diff(s.avgWinLossRatio, previous.avgWinLossRatio),
        expectancyR: diff(s.expectancyR, previous.expectancyR),
        maxDrawdown: toDec(toScaled(s.maxDrawdown) - toScaled(previous.maxDrawdown)),
      }
    : null

  const sorted = [...ledger.closed]
    .sort((a, b) => a.exitTime - b.exitTime || a.id - b.id)
    .filter((c) => (from === null || c.exitTime >= from) && (to === null || c.exitTime < to))
  const ends = sorted.flatMap((c, i) => (i === sorted.length - 1 || dayKey(sorted[i + 1].exitTime, sorted[i + 1].tzOffsetMin) !== dayKey(c.exitTime, c.tzOffsetMin) ? [i + 1] : []))
  const sparklines: Sparklines = { netPnl: [], winRate: [], profitFactor: [], avgWinLossRatio: [], expectancyR: [], maxDrawdown: [] }
  for (const end of ends.slice(-30)) {
    const r = summarize(sorted.slice(0, end))
    sparklines.netPnl.push(asNumber(toScaled(r.netPnl)))
    sparklines.winRate.push(r.winRate)
    sparklines.profitFactor.push(r.profitFactor)
    sparklines.avgWinLossRatio.push(r.avgWinLossRatio)
    sparklines.expectancyR.push(r.expectancyR)
    sparklines.maxDrawdown.push(asNumber(toScaled(r.maxDrawdown)))
  }
  return { report: current, from, to, previousFrom, previousTo: from, previous, comparison, sparklines }
}

export function mockCalendar(ledger: MockLedger, q: CalendarQuery): Calendar {
  if (q.month < 1 || q.month > 12) throw new Error(`invalid input: invalid month ${q.year}-${q.month}`)
  const first = Date.UTC(q.year, q.month - 1, 1)
  const daysInMonth = new Date(Date.UTC(q.year, q.month, 0)).getUTCDate()
  const from = first - q.tzOffsetMin * 60_000
  const to = from + daysInMonth * DAY
  const r = report(ledger, from, to)
  const prefix = `${String(q.year).padStart(4, '0')}-${String(q.month).padStart(2, '0')}-`
  const maxAbs = r.daily.reduce((m, d) => { const v = Math.abs(asNumber(toScaled(d.netPnl))); return v > m ? v : m }, 0)
  return {
    year: q.year,
    month: q.month,
    daysInMonth,
    firstWeekday: ((new Date(first).getUTCDay() + 6) % 7) + 1,
    currency: r.currency,
    days: r.daily
      .filter((d) => d.day.startsWith(prefix))
      .map((d) => ({ ...d, dayOfMonth: Number(d.day.slice(8)), intensity: maxAbs > 0 ? asNumber(toScaled(d.netPnl)) / maxAbs : 0 })),
    summary: r.summary,
  }
}

export function mockDayTrades(ledger: MockLedger, day: string): DayTrade[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new Error(`invalid input: invalid day "${day}"`)
  return [...ledger.closed]
    .sort((a, b) => a.exitTime - b.exitTime || a.id - b.id)
    .filter((c) => dayKey(c.exitTime, c.tzOffsetMin) === day)
    .map((c) => ({ tradeId: c.id, symbol: c.symbol, direction: c.direction, exitTime: c.exitTime, netPnl: c.netPnl, rMultiple: c.rMultiple, outcome: c.outcome }))
}
