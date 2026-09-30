import type { Account } from '../types/account'
import type { Alert } from '../types/alerts'
import type {
  ConsistencyStatus,
  DailyLossStatus,
  DailyReference,
  DayPnl,
  MaxLossKind,
  MaxLossStatus,
  ProfitTargetStatus,
  PropAlertDetail,
  PropLevel,
  PropLimit,
  PropLimitInput,
  PropRules,
  PropRulesInput,
  PropStatus,
  ResetZone,
  TradingDay,
} from '../types/prop'

/**
 * MOCK du suivi prop firm (lot 33) — uniquement pour `npm run dev` dans un navigateur.
 * Miroir EXACT de `pulse-core/src/prop/` et `alerts/prop.rs` (CLAUDE.md, « Suivi prop firm ») :
 * montants en BigInt (échelle de 30 chiffres, comme `mockSizing.ts`), mêmes codes de refus,
 * mêmes règles d'heure de Paris et de New York. Vérifié par `mockProp.test.ts` sur les MÊMES cas
 * que les tests Rust. Dans l'application, tout vient de Rust.
 */

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
export const WARNING_PERCENT = 70
export const CRITICAL_PERCENT = 90
export const MAX_PHASE_LABEL_CHARS = 60
export const MAX_MIN_TRADING_DAYS = 1000

// --- Décimaux exacts -----------------------------------------------------------------------------

const S = 30
const ONE = 10n ** BigInt(S)
const HUNDRED = 100n * ONE

const DECIMAL_RE = /^-?(\d+\.?\d*|\.\d+)$/
/** Même lecture que `money::parse` : notation simple seulement (ni exposant, ni virgule, ni espace). */
export function isPlainDecimal(v: string): boolean {
  const s = v.trim()
  return DECIMAL_RE.test(s) && /\d/.test(s)
}
const parse = (v: string): bigint => {
  const s = v.trim()
  const neg = s.startsWith('-')
  const [i, f = ''] = (neg ? s.slice(1) : s).split('.')
  const n = BigInt((i || '0') + f.padEnd(S, '0').slice(0, S))
  return neg ? -n : n
}
/** Chaîne décimale sans zéros de fin (la valeur de Rust, à l'échelle près). */
const str = (n: bigint): string => {
  const neg = n < 0n
  const digits = (neg ? -n : n).toString().padStart(S + 1, '0')
  const frac = digits.slice(-S).replace(/0+$/, '')
  const body = `${digits.slice(0, -S)}${frac ? `.${frac}` : ''}`
  return neg && body !== '0' ? `-${body}` : body
}
const mulDec = (a: bigint, b: bigint) => (a * b) / ONE
const ratio = (a: bigint, b: bigint): number | null => (b === 0n ? null : Number((a * 10n ** 12n) / b) / 1e12)
const max = (a: bigint, b: bigint) => (a > b ? a : b)

// --- Heure de Paris et de New York (miroir de `news::zones`) --------------------------------------

type Zone = 'paris' | 'newYork'
const isoWeekday = (day: number) => ((((day + 3) % 7) + 7) % 7) + 1
function lastSunday(year: number, month: number): number {
  const last = Date.UTC(year, month, 0) / DAY
  return last - (isoWeekday(last) % 7)
}
function nthSunday(year: number, month: number, n: number): number {
  const first = Date.UTC(year, month - 1, 1) / DAY
  return first + ((7 - isoWeekday(first)) % 7) + 7 * (n - 1)
}
export function offsetMin(zone: Zone, utc: number): number {
  const y = new Date(Math.floor(utc / DAY) * DAY).getUTCFullYear()
  if (zone === 'paris') {
    const start = lastSunday(y, 3) * DAY + HOUR
    const end = lastSunday(y, 10) * DAY + HOUR
    return utc >= start && utc < end ? 120 : 60
  }
  const start = nthSunday(y, 3, 2) * DAY + 7 * HOUR
  const end = nthSunday(y, 11, 1) * DAY + 6 * HOUR
  return utc >= start && utc < end ? -240 : -300
}
function toUtcFirst(zone: Zone, day: number, minute: number): number | null {
  const local = day * DAY + minute * MIN
  const found = (zone === 'paris' ? [120, 60] : [-240, -300]).map((off) => local - off * MIN).filter((utc) => offsetMin(zone, utc) === (local - utc) / MIN)
  return found.length ? Math.min(...found) : null
}
export const dayKeyOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10)
const parisDay = (utc: number) => dayKeyOf(Math.floor((utc + offsetMin('paris', utc) * MIN) / DAY))
const parisHhmm = (utc: number) => {
  const m = Math.floor(((((utc + offsetMin('paris', utc) * MIN) % DAY) + DAY) % DAY) / MIN)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
export function parseDay(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = Date.UTC(y, mo - 1, d)
  const back = new Date(t)
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t / DAY : null
}
/** « HH:MM » strict (comme `reminder::parse_time`) → minutes depuis minuit. */
export function parseTime(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s)
  if (!m) return null
  const [h, mi] = [Number(m[1]), Number(m[2])]
  return h < 24 && mi < 60 ? h * 60 + mi : null
}

/** Premier instant où l'horloge de la zone affiche `minute` ce jour-là ; dans le trou du printemps, l'instant du saut. */
export function resetInstant(zone: Zone, day: number, minute: number): number {
  for (let m = minute; m < 24 * 60; m++) {
    const t = toUtcFirst(zone, day, m)
    if (t !== null) return t
  }
  return day * DAY + minute * MIN - offsetMin(zone, day * DAY) * MIN
}
/** Jour de trading contenant `t`, nommé par la date locale où il commence. */
export function tradingDay(zone: Zone, resetMinute: number, t: number): number {
  const local = Math.floor((t + offsetMin(zone, t) * MIN) / DAY)
  return t >= resetInstant(zone, local, resetMinute) ? local : local - 1
}
function describeDay(zone: Zone, resetMinute: number, day: number): TradingDay {
  const startsAt = resetInstant(zone, day, resetMinute)
  const endsAt = resetInstant(zone, day + 1, resetMinute)
  return {
    key: dayKeyOf(day),
    startsAt,
    endsAt,
    startsParisDay: parisDay(startsAt),
    startsParisTime: parisHhmm(startsAt),
    endsParisDay: parisDay(endsAt),
    endsParisTime: parisHhmm(endsAt),
  }
}

// --- Validation (miroir de `prop::rules::validate`) ----------------------------------------------

const refuse = (code: string) => new Error(`invalid input: prop:${code}`)

function limitOf(field: string, input: PropLimitInput): PropLimit {
  const mode = input.mode.trim()
  if (mode !== 'percent' && mode !== 'amount') throw refuse(`invalidMode:${field}`)
  if (!isPlainDecimal(input.value)) throw refuse(`invalidNumber:${field}`)
  const v = parse(input.value)
  if (mode === 'percent' && (v <= 0n || v > HUNDRED)) throw refuse(`percentOutOfRange:${field}`)
  if (mode === 'amount' && v <= 0n) throw refuse(`amountNotPositive:${field}`)
  return { mode, value: input.value.trim() }
}

export function validatePropRules(accountId: number, i: PropRulesInput): PropRules {
  const label = i.phaseLabel?.trim() || null
  if (label && [...label].length > MAX_PHASE_LABEL_CHARS) throw refuse('phaseLabelTooLong')
  const startedOn = i.startedOn.trim()
  if (parseDay(startedOn) === null) throw refuse('invalidStartDay')
  const dailyLoss = i.dailyLoss ? limitOf('dailyLoss', i.dailyLoss) : null
  const ref = i.dailyReference.trim()
  if (ref !== 'initialBalance' && ref !== 'dayStartBalance') throw refuse('invalidDailyReference')
  const maxLoss = i.maxLoss ? limitOf('maxLoss', i.maxLoss) : null
  const kind = i.maxLossKind.trim()
  if (kind !== 'static' && kind !== 'trailing') throw refuse('invalidMaxLossKind')
  const resetTime = i.resetTime.trim()
  if (parseTime(resetTime) === null) throw refuse('invalidResetTime')
  const zone = i.resetZone.trim()
  if (zone !== 'paris' && zone !== 'newYork') throw refuse('unknownZone')
  const profitTarget = i.profitTarget ? limitOf('profitTarget', i.profitTarget) : null
  if (i.minTradingDays !== null && !(i.minTradingDays >= 1 && i.minTradingDays <= MAX_MIN_TRADING_DAYS && Number.isInteger(i.minTradingDays))) {
    throw refuse('minTradingDaysOutOfRange')
  }
  let consistency: string | null = null
  const c = i.consistencyMaxBestDayPercent?.trim()
  if (c) {
    if (!isPlainDecimal(c)) throw refuse('invalidNumber:consistency')
    const v = parse(c)
    if (v <= 0n || v > HUNDRED) throw refuse('percentOutOfRange:consistency')
    consistency = c
  }
  return {
    accountId,
    phaseLabel: label,
    startedOn,
    dailyLoss,
    dailyReference: ref as DailyReference,
    maxLoss,
    maxLossKind: kind as MaxLossKind,
    trailingLocksAtInitial: i.trailingLocksAtInitial,
    resetTime,
    resetZone: zone as ResetZone,
    profitTarget,
    minTradingDays: i.minTradingDays,
    consistencyMaxBestDayPercent: consistency,
  }
}

// --- Calcul (miroir de `prop::compute`) ----------------------------------------------------------

export interface MockClosedTrade {
  id: number
  exitTime: number
  netPnl: string
}
export interface MockPropInput {
  rules: PropRules
  currency: string
  initialCapital: string
  closed: MockClosedTrade[]
  openTradeCount: number
  cashFlowCount: number
}

function level(consumed: bigint, limit: bigint): PropLevel {
  if (consumed >= limit) return 'reached'
  const used = consumed * 100n
  if (used >= limit * BigInt(CRITICAL_PERCENT)) return 'critical'
  if (used >= limit * BigInt(WARNING_PERCENT)) return 'warning'
  return 'ok'
}
const RANK: Record<PropLevel, number> = { ok: 0, warning: 1, critical: 2, reached: 3 }

function moneyOf(rule: PropLimit, base: bigint): bigint | null {
  const v = rule.mode === 'amount' ? parse(rule.value) : (parse(rule.value) * base) / HUNDRED
  return v > 0n ? v : null
}

export function computeProp(input: MockPropInput, now: number): PropStatus {
  const r = input.rules
  const zone: Zone = r.resetZone
  const resetMinute = parseTime(r.resetTime) ?? 0
  const startedAt = resetInstant(zone, parseDay(r.startedOn) ?? 0, 0)
  const dayOf = (t: number) => tradingDay(zone, resetMinute, t)
  const sorted = [...input.closed].sort((a, b) => a.exitTime - b.exitTime || a.id - b.id)
  const beforeStartCount = sorted.filter((t) => t.exitTime < startedAt).length
  const trades = sorted.filter((t) => t.exitTime >= startedAt)

  const initial = parse(input.initialCapital)
  const today = dayOf(now)
  const todayStart = resetInstant(zone, today, resetMinute)
  let balance = initial
  let peak = initial
  let dayStartBalance = initial
  let dayNet = 0n
  let dayCount = 0
  const days: [number, bigint, number][] = []
  for (const t of trades) {
    const pnl = parse(t.netPnl)
    if (t.exitTime < todayStart) dayStartBalance += pnl
    balance += pnl
    peak = max(peak, balance)
    const d = dayOf(t.exitTime)
    if (d === today) {
      dayNet += pnl
      dayCount++
    }
    const last = days[days.length - 1]
    if (last && last[0] === d) {
      last[1] += pnl
      last[2]++
    } else days.push([d, pnl, 1])
  }
  const netPnl = balance - initial

  let dailyLoss: DailyLossStatus | null = null
  if (r.dailyLoss) {
    const reference = r.dailyReference === 'initialBalance' ? initial : dayStartBalance
    const limit = moneyOf(r.dailyLoss, reference)
    const loss = dayNet < 0n ? -dayNet : 0n
    dailyLoss = {
      rule: r.dailyLoss,
      reference: r.dailyReference,
      referenceBalance: str(reference),
      limit: limit === null ? null : str(limit),
      dayNetPnl: str(dayNet),
      loss: str(loss),
      remaining: limit === null ? null : str(limit - loss),
      used: limit === null ? null : ratio(loss, limit),
      level: limit === null ? null : level(loss, limit),
      tradeCount: dayCount,
    }
  }

  let maxLoss: MaxLossStatus | null = null
  if (r.maxLoss) {
    const limit = moneyOf(r.maxLoss, initial)
    let floor: bigint | null = null
    let floorLocked = false
    if (limit !== null) {
      if (r.maxLossKind === 'static') floor = initial - limit
      else {
        const trailing = peak - limit
        if (r.trailingLocksAtInitial && trailing >= initial) {
          floor = initial
          floorLocked = true
        } else floor = trailing
      }
    }
    const remaining = limit !== null && floor !== null ? balance - floor : null
    const consumed = limit !== null && remaining !== null ? limit - remaining : null
    maxLoss = {
      rule: r.maxLoss,
      kind: r.maxLossKind,
      locksAtInitial: r.trailingLocksAtInitial,
      limit: limit === null ? null : str(limit),
      peak: str(peak),
      floor: floor === null ? null : str(floor),
      floorLocked,
      remaining: remaining === null ? null : str(remaining),
      used: limit !== null && consumed !== null ? Math.max(0, ratio(consumed, limit) ?? 0) : null,
      level: limit !== null && consumed !== null ? level(consumed, limit) : null,
    }
  }

  let profitTarget: ProfitTargetStatus | null = null
  if (r.profitTarget) {
    const target = moneyOf(r.profitTarget, initial)
    profitTarget = {
      rule: r.profitTarget,
      target: target === null ? null : str(target),
      gain: str(netPnl),
      remaining: target === null ? null : str(max(target - netPnl, 0n)),
      progress: target === null ? null : ratio(netPnl, target),
      reached: target === null ? null : netPnl >= target,
    }
  }

  const count = days.length
  const tradingDays = {
    count,
    minimum: r.minTradingDays,
    missing: r.minTradingDays === null ? null : Math.max(0, r.minTradingDays - count),
    done: r.minTradingDays === null ? null : count >= r.minTradingDays,
  }

  let consistency: ConsistencyStatus | null = null
  if (r.consistencyMaxBestDayPercent !== null) {
    const cap = parse(r.consistencyMaxBestDayPercent)
    let best: [number, bigint, number] | null = null
    for (const d of days) if (best === null || d[1] > best[1]) best = d
    const bestDay: DayPnl | null = best ? { day: describeDay(zone, resetMinute, best[0]), netPnl: str(best[1]), tradeCount: best[2] } : null
    const total = netPnl
    let share: number | null = null
    let violated: boolean | null = null
    let used: number | null = null
    let lvl: PropLevel | null = null
    if (best && total > 0n && best[1] > 0n) {
      const lhs = best[1] * 100n
      const rhs = mulDec(cap, total)
      violated = lhs > rhs
      const l = level(lhs, rhs)
      lvl = violated ? 'reached' : l === 'reached' ? 'critical' : l
      share = ratio(best[1], total)
      used = ratio(lhs, rhs)
    }
    consistency = {
      maxBestDayPercent: r.consistencyMaxBestDayPercent,
      totalProfit: str(total),
      bestDay,
      share,
      bestDayAllowed: total > 0n ? str(mulDec(cap, total) / 100n) : null,
      violated,
      used,
      level: lvl,
    }
  }

  const next = resetInstant(zone, today + 1, resetMinute)
  const last = trades[trades.length - 1]
  return {
    accountId: r.accountId,
    currency: input.currency,
    rules: r,
    thresholds: { warningPercent: WARNING_PERCENT, criticalPercent: CRITICAL_PERCENT },
    now,
    startedAt,
    initialCapital: str(initial),
    balance: str(balance),
    netPnl: str(netPnl),
    closedTradeCount: trades.length,
    beforeStartCount,
    openTradeCount: input.openTradeCount,
    cashFlowCount: input.cashFlowCount,
    lastTradeId: last?.id ?? null,
    lastExitAt: last?.exitTime ?? null,
    tradingDay: describeDay(zone, resetMinute, today),
    nextReset: { at: next, inMs: next - now, parisDay: parisDay(next), parisTime: parisHhmm(next) },
    dailyLoss,
    maxLoss,
    profitTarget,
    tradingDays,
    consistency,
    alertsEnabled: true,
  }
}

// --- Alertes (miroir de `alerts/prop.rs`) --------------------------------------------------------

type PropAlert = Extract<Alert, { kind: 'propDailyLoss' | 'propMaxLoss' | 'propConsistency' }>

export function evaluatePropAlerts(s: PropStatus): PropAlert[] {
  const acc = s.accountId
  const start = s.rules.startedOn
  const at = s.lastExitAt ?? s.now
  const base: PropAlertDetail = {
    level: 'ok',
    currency: s.currency,
    phaseLabel: s.rules.phaseLabel,
    used: null,
    remaining: null,
    limit: null,
    tradingDay: null,
    nextResetParisDay: null,
    nextResetParisTime: null,
    share: null,
    maxBestDayPercent: null,
  }
  const out: PropAlert[] = []
  const push = (kind: PropAlert['kind'], scope: string, lvl: PropLevel, detail: PropAlertDetail) =>
    out.push({
      ...detail,
      kind,
      id: `${kind}:${acc}:${scope}:${lvl}`,
      accountId: acc,
      severity: lvl === 'warning' ? 'warning' : 'critical',
      messageKey: `${kind}.${lvl}` as PropAlert['messageKey'],
      at,
      tradeId: s.lastTradeId,
    } as PropAlert)
  const d = s.dailyLoss
  if (d?.level && RANK[d.level] >= RANK.warning) {
    push('propDailyLoss', `${start}:${s.tradingDay.key}`, d.level, {
      ...base,
      level: d.level,
      used: d.used,
      remaining: d.remaining,
      limit: d.limit,
      tradingDay: s.tradingDay.key,
      nextResetParisDay: s.nextReset.parisDay,
      nextResetParisTime: s.nextReset.parisTime,
    })
  }
  const m = s.maxLoss
  if (m?.level && RANK[m.level] >= RANK.warning) {
    push('propMaxLoss', start, m.level, { ...base, level: m.level, used: m.used, remaining: m.remaining, limit: m.limit })
  }
  const c = s.consistency
  if (c?.level && RANK[c.level] >= RANK.warning) {
    push('propConsistency', start, c.level, { ...base, level: c.level, used: c.used, share: c.share, maxBestDayPercent: c.maxBestDayPercent })
  }
  return out
}

/** Une alerte déjà vue à un niveau PIRE pour la même règle et la même portée n'est pas une nouvelle alerte. */
export function dropImprovements<T extends { id: string }>(alerts: T[], logged: string[]): T[] {
  const split = (id: string) => {
    const i = id.lastIndexOf(':')
    return [id.slice(0, i), id.slice(i + 1)] as const
  }
  return alerts.filter((a) => {
    const [scope, lvl] = split(a.id)
    if (!(lvl in RANK)) return true
    return !logged.some((id) => {
      const [s, l] = split(id)
      return s === scope && l in RANK && RANK[l as PropLevel] > RANK[lvl as PropLevel]
    })
  })
}

// --- Magasin simulé (règles par compte, réglage alerts.prop) --------------------------------------

export interface PropMockDeps {
  accounts: () => Account[]
  /** Trades clôturés du compte tels qu'à `now` (entrés au plus tard à `now`, sortis au plus tard à `now`). */
  closed: (accountId: number, now: number) => MockClosedTrade[]
  openCount: (accountId: number, now: number) => number
  cashFlowCount: (accountId: number, now: number) => number
  now: () => number
}

export function createPropMock(deps: PropMockDeps) {
  const rules = new Map<number, PropRules>()
  let alertsEnabled = true
  const requireProp = (accountId: number): Account => {
    const a = deps.accounts().find((x) => x.id === accountId)
    if (!a) throw new Error(`not found: account ${accountId}`)
    if (a.kind !== 'prop') throw refuse('notProp')
    return a
  }
  const status = (accountId: number, now = deps.now()): PropStatus | null => {
    const a = requireProp(accountId)
    const r = rules.get(accountId)
    if (!r) return null
    const s = computeProp(
      {
        rules: r,
        currency: a.currency,
        initialCapital: a.initialCapital,
        closed: deps.closed(accountId, now),
        openTradeCount: deps.openCount(accountId, now),
        cashFlowCount: deps.cashFlowCount(accountId, now),
      },
      now,
    )
    return { ...s, alertsEnabled }
  }
  return {
    getPropRules: async (accountId: number): Promise<PropRules | null> => {
      requireProp(accountId)
      return rules.get(accountId) ?? null
    },
    setPropRules: async (accountId: number, input: PropRulesInput): Promise<PropRules> => {
      requireProp(accountId)
      const r = validatePropRules(accountId, input)
      rules.set(accountId, r)
      return r
    },
    deletePropRules: async (accountId: number): Promise<void> => {
      if (!deps.accounts().some((a) => a.id === accountId)) throw new Error(`not found: account ${accountId}`)
      rules.delete(accountId)
    },
    getPropStatus: async (accountId: number): Promise<PropStatus | null> => status(accountId),
    setPropAlerts: async (enabled: boolean): Promise<boolean> => {
      alertsEnabled = enabled
      return alertsEnabled
    },
    /** Alertes prop d'un compte à `now` (vide : réglage éteint, compte non prop ou sans règles). */
    alertsFor: (account: Account, now: number, logged: string[]): PropAlert[] => {
      if (account.kind !== 'prop' || !alertsEnabled || !rules.has(account.id)) return []
      const s = status(account.id, now)
      return s ? dropImprovements(evaluatePropAlerts(s), logged) : []
    },
    /** Compte supprimé : ses règles partent avec lui (cascade de la migration v16). */
    forget: (accountId: number) => rules.delete(accountId),
  }
}
