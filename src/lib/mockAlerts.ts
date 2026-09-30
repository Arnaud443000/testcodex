import type { Account, CashFlow } from '../types/account'
import type { BehaviorSettings } from '../types/behavior'
import type { Tag, TradeView } from '../types/trade'
import type { Alert, AlertDetail, AlertMessageKey, AlertSettings, AlertSeverity, LimitLevel, LossDetail } from '../types/alerts'
import { dayKey, localDay, ratio, toDec, toScaled } from './mockStats'
import { mockRevengeOf } from './mockBehavior'

/**
 * MOCK des alertes à seuils — uniquement pour `npm run dev` dans un navigateur.
 * Il suit CLAUDE.md (« Alertes à seuils (lot 12) ») sur les données du faux backend ;
 * dans l'application, tout vient de pulse-core (`alerts::evaluate`). Montants en BigInt exacts.
 */

const DAY = 86_400_000
const MIN = 60_000
const HUNDRED = 100n
const SCALE_ONE = toScaled('1')
export const MIN_SESSION_HISTORY = 20
export const UNUSUAL_SESSION_PERCENT = 10

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  consecutiveLosses: 3,
  burstMaxTrades: 3,
  burstWindowMin: 60,
  dailyLossPercent: '3',
  dailyLossAmount: null,
  weeklyLossPercent: '6',
  weeklyLossAmount: null,
  revenge: true,
  tradingHours: null,
  unusualSession: true,
  noStopLoss: true,
}

/** « HH:MM-HH:MM » → minutes [début, fin) ; `null` si mal formé ou vide (début = fin). */
export function parseHours(s: string): [number, number] | null {
  const m = /^\s*([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)\s*$/.exec(s)
  if (!m) return null
  const start = Number(m[1]) * 60 + Number(m[2])
  const end = Number(m[3]) * 60 + Number(m[4])
  return start === end ? null : [start, end]
}

const inHours = (minute: number, [start, end]: [number, number]) => (start < end ? minute >= start && minute < end : minute >= start || minute < end)

/** Mêmes refus que `alerts::settings::set`. */
export function checkAlertSettings(s: AlertSettings): void {
  const invalid = (m: string) => new Error(`invalid input: ${m}`)
  if (s.consecutiveLosses !== null && !(s.consecutiveLosses >= 2 && s.consecutiveLosses <= 20)) throw invalid('the number of consecutive losses must be between 2 and 20')
  if (s.burstMaxTrades !== null && !(s.burstMaxTrades >= 1 && s.burstMaxTrades <= 100)) throw invalid('the maximum number of trades in the window must be between 1 and 100')
  if (!(s.burstWindowMin >= 1 && s.burstWindowMin <= 1440)) throw invalid('the trade window must be between 1 minute and 24 hours')
  for (const p of [s.dailyLossPercent, s.weeklyLossPercent]) {
    if (p !== null && (toScaled(p) <= 0n || toScaled(p) > toScaled('100'))) throw invalid('a loss limit in percent must be greater than 0 and at most 100')
  }
  for (const a of [s.dailyLossAmount, s.weeklyLossAmount]) {
    if (a !== null && toScaled(a) <= 0n) throw invalid('a loss limit in money must be greater than 0')
  }
  if (s.tradingHours !== null && parseHours(s.tradingHours) === null) throw invalid('trading hours must look like 09:00-17:30, with a different start and end')
}

export interface AlertInput {
  account: Account
  /** Tous les trades du compte, ouverts compris. */
  trades: TradeView[]
  cashFlows: CashFlow[]
  tags: Tag[]
  behavior: BehaviorSettings
  settings: AlertSettings
}

type Closed = TradeView & { exitTime: number; figures: NonNullable<TradeView['figures']> }
const isClosed = (t: TradeView): t is Closed => t.figures !== null && t.exitTime != null

/** Session déduite de l'heure UTC d'entrée (comme `trade_view::session_for`). */
const sessionFor = (entryTime: number) => {
  const h = ((Math.floor(entryTime / 3_600_000) % 24) + 24) % 24
  return h >= 7 && h <= 12 ? 'Londres' : h >= 13 && h <= 21 ? 'New York' : 'Asie'
}
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const RANK: Record<AlertDetail['kind'], number> = {
  consecutiveLosses: 0, tradesPerDay: 1, tradesPerWindow: 2, dailyLoss: 3, weeklyLoss: 4, revenge: 5, outsideHours: 6, unusualSession: 7, noStopLoss: 8,
  // Lot 25 : rang de pulse-core ; l'alerte 3.6.8 elle-même n'est pas simulée dans le navigateur.
  newsTrade: 9,
  // Lot 31 : alerte facultative « sans analyse du jour » (rang de pulse-core).
  noAnalysis: 10,
}
const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1 }

export function sortAlerts(alerts: Alert[]): Alert[] {
  return alerts.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      RANK[a.kind] - RANK[b.kind] ||
      (a.tradeId ?? 0) - (b.tradeId ?? 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

const level = (count: number, max: number): [LimitLevel, AlertSeverity] | null =>
  count < max ? null : count === max ? ['reached', 'warning'] : ['exceeded', 'critical']

/** Alertes actives à l'instant `now` pour un compte (décalage `tz` de l'appelant pour « aujourd'hui »). */
export function mockEvaluateAlerts(input: AlertInput, now: number, tz: number): Alert[] {
  const { account, behavior, settings: s } = input
  const acc = account.id
  // Le compte tel qu'il était à `now`.
  const trades = input.trades
    .filter((t) => t.accountId === acc && t.entryTime <= now)
    .map((t) => (t.exitTime != null && t.exitTime > now ? { ...t, exitTime: null, exitPrice: null, figures: null, durationMs: null } : t))
  const flows = input.cashFlows.filter((f) => f.accountId === acc && f.occurredAt <= now)
  const today = localDay(now, tz)
  const monday = today - ((((today + 3) % 7) + 7) % 7)
  const out: Alert[] = []
  const push = (severity: AlertSeverity, messageKey: AlertMessageKey, at: number, tradeId: number, scope: string, detail: AlertDetail) =>
    out.push({ ...detail, id: `${messageKey.split('.')[0]}:${acc}:${scope}`, accountId: acc, severity, messageKey, at, tradeId } as Alert)

  const entered = [...trades].sort((a, b) => a.entryTime - b.entryTime || a.id - b.id)
  const isToday = (t: TradeView) => localDay(t.entryTime, t.tzOffsetMin) === today
  const enteredToday = entered.filter(isToday)
  const closed = trades.filter(isClosed).sort((a, b) => a.exitTime - b.exitTime || a.id - b.id)
  const closedFrom = (from: number) => closed.filter((c) => { const d = localDay(c.exitTime, c.tzOffsetMin); return d >= from && d <= today })
  const closedToday = closedFrom(today)
  const balanceBefore = (instant: number): bigint => {
    let b = toScaled(account.initialCapital)
    for (const f of flows) if (f.occurredAt < instant) b += (f.kind === 'deposit' ? 1n : -1n) * toScaled(f.amount)
    for (const c of closed) if (c.exitTime < instant) b += toScaled(c.figures.netPnl)
    return b
  }

  // 3.6.1
  if (s.consecutiveLosses !== null) {
    const streak: Closed[] = []
    for (let i = closedToday.length - 1; i >= 0 && closedToday[i].figures.outcome === 'loss'; i--) streak.unshift(closedToday[i])
    const last = streak[streak.length - 1]
    if (last && streak.length >= s.consecutiveLosses) {
      push('warning', 'consecutiveLosses', last.exitTime, last.id, String(last.id), { kind: 'consecutiveLosses', count: streak.length, threshold: s.consecutiveLosses, tradeIds: streak.map((c) => c.id) })
    }
  }
  // 3.6.2
  const lastToday = enteredToday[enteredToday.length - 1]
  const perDay = behavior.maxTradesPerDay !== null && lastToday ? level(enteredToday.length, behavior.maxTradesPerDay) : null
  if (perDay && lastToday && behavior.maxTradesPerDay !== null) {
    push(perDay[1], `tradesPerDay.${perDay[0]}`, lastToday.entryTime, lastToday.id, String(lastToday.id), {
      kind: 'tradesPerDay', level: perDay[0], count: enteredToday.length, threshold: behavior.maxTradesPerDay, day: dayKey(now, tz),
    })
  }
  if (s.burstMaxTrades !== null) {
    const recent = entered.filter((t) => t.entryTime > now - s.burstWindowMin * MIN)
    const last = recent[recent.length - 1]
    const l = level(recent.length, s.burstMaxTrades)
    if (last && l) {
      push(l[1], `tradesPerWindow.${l[0]}`, last.entryTime, last.id, String(last.id), {
        kind: 'tradesPerWindow', level: l[0], count: recent.length, threshold: s.burstMaxTrades, windowMin: s.burstWindowMin,
      })
    }
  }
  // 3.6.3
  const periods: [number, Closed[], string | null, string | null, 'dailyLoss' | 'weeklyLoss'][] = [
    [today, closedToday, s.dailyLossAmount, s.dailyLossPercent, 'dailyLoss'],
    [monday, closedFrom(monday), s.weeklyLossAmount, s.weeklyLossPercent, 'weeklyLoss'],
  ]
  for (const [first, list, amount, percent, kind] of periods) {
    const last = list[list.length - 1]
    if ((amount === null && percent === null) || !last) continue
    const total = list.reduce((sum, c) => sum + toScaled(c.figures.netPnl), 0n)
    if (total >= 0n) continue
    const loss = -total
    const start = first * DAY - tz * MIN
    const balance = balanceBefore(start)
    const amountReached = amount !== null && loss >= toScaled(amount)
    const percentReached = percent !== null && balance > 0n && loss * HUNDRED * SCALE_ONE >= toScaled(percent) * balance
    if (!amountReached && !percentReached) continue
    const periodStart = dayKey(start, tz)
    const detail: LossDetail = {
      periodStart, currency: account.currency, loss: toDec(loss), referenceBalance: toDec(balance),
      lossPct: balance > 0n ? ratio(loss, balance) : null, thresholdAmount: amount, thresholdPercent: percent, amountReached, percentReached,
    }
    const scope = amountReached && percentReached ? 'amount+percent' : amountReached ? 'amount' : 'percent'
    push('critical', kind, last.exitTime, last.id, `${periodStart}:${scope}`, { kind, ...detail })
  }
  // 3.6.4, 3.6.5
  const hours = s.tradingHours !== null ? parseHours(s.tradingHours) : null
  const revengeInput = { accounts: [account], cashFlows: flows, trades, tags: input.tags, rules: [], settings: behavior }
  const sessionOf = (t: TradeView) => {
    const tag = input.tags.find((g) => g.kind === 'session' && t.tagIds.includes(g.id))
    const name = tag ? tag.name : sessionFor(t.entryTime)
    return { name, key: name.trim().toLowerCase() }
  }
  entered.forEach((t, i) => {
    if (!isToday(t)) return
    const r = s.revenge ? mockRevengeOf(revengeInput, t) : null
    if (r) {
      push('warning', 'revenge', t.entryTime, t.id, String(t.id), {
        kind: 'revenge', previousTradeId: r.previousTradeId, gapMs: r.gapMs, basis: r.basis, ratio: r.ratio, sizeFactor: behavior.revengeSizeFactor, windowMin: behavior.revengeWindowMin,
      })
    }
    if (hours && s.tradingHours !== null) {
      const minute = Math.floor(((((t.entryTime + t.tzOffsetMin * MIN) % DAY) + DAY) % DAY) / MIN)
      if (!inHours(minute, hours)) push('warning', 'outsideHours', t.entryTime, t.id, String(t.id), { kind: 'outsideHours', localTime: hhmm(minute), tradingHours: s.tradingHours.trim() })
    }
    const history = entered.slice(0, i)
    if (s.unusualSession && history.length >= MIN_SESSION_HISTORY) {
      const { name, key } = sessionOf(t)
      const same = history.filter((h) => sessionOf(h).key === key).length
      if (same * 100 < UNUSUAL_SESSION_PERCENT * history.length) {
        push('warning', 'unusualSession', t.entryTime, t.id, String(t.id), { kind: 'unusualSession', session: name, sessionCount: same, historyCount: history.length, share: same / history.length })
      }
    }
  })
  // 3.6.6
  if (s.noStopLoss) {
    for (const t of entered) {
      const open = t.exitTime == null
      if ((open || isToday(t)) && t.initialRisk === null) {
        push(open ? 'critical' : 'warning', open ? 'noStopLoss.open' : 'noStopLoss.closed', t.entryTime, t.id, String(t.id), { kind: 'noStopLoss', open })
      }
    }
  }
  return sortAlerts(out)
}
