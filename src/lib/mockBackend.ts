import type { Account, CashFlow, NewAccount, NewCashFlow } from '../types/account'
import type { Decimal } from '../types/money'
import type {
  ChecklistItem,
  Figures,
  Instrument,
  NewInstrument,
  Outcome,
  Preview,
  Rule,
  Tag,
  TagKind,
  TradeData,
  TradeFilter,
  TradeView,
} from '../types/trade'
import type { CalendarQuery, DashboardQuery } from '../types/stats'
import { mockCalendar, mockDashboard, mockDayTrades, type MockLedger } from './mockStats'

/**
 * MOCK EN MÉMOIRE — uniquement pour `npm run dev` dans un navigateur, sans Rust.
 * Il imite les commandes Tauri (mêmes noms, mêmes formes de données, mêmes refus
 * principaux) mais la vraie logique est dans pulse-core. Dans l'application, rien
 * de ce fichier n'est appelé : les chiffres viennent toujours de pulse-core.
 * Les montants sont calculés ici en entiers exacts (BigInt), jamais en flottants.
 */

// --- décimaux exacts (BigInt à échelle fixe) ---------------------------------
interface Dec {
  n: bigint
  s: number
}
const parse = (v: Decimal): Dec => {
  const neg = v.startsWith('-')
  const [i, f = ''] = (neg ? v.slice(1) : v).split('.')
  const n = BigInt(i + f)
  return { n: neg ? -n : n, s: f.length }
}
const align = (a: Dec, b: Dec): [bigint, bigint, number] => {
  const s = Math.max(a.s, b.s)
  return [a.n * 10n ** BigInt(s - a.s), b.n * 10n ** BigInt(s - b.s), s]
}
const sub = (a: Dec, b: Dec): Dec => {
  const [x, y, s] = align(a, b)
  return { n: x - y, s }
}
const mul = (a: Dec, b: Dec): Dec => ({ n: a.n * b.n, s: a.s + b.s })
const sign = (a: Dec) => (a.n > 0n ? 1 : a.n < 0n ? -1 : 0)
const str = (a: Dec): Decimal => {
  const neg = a.n < 0n
  const digits = (neg ? -a.n : a.n).toString().padStart(a.s + 1, '0')
  const body = a.s ? `${digits.slice(0, -a.s)}.${digits.slice(-a.s)}` : digits
  return neg ? `-${body}` : body
}
const ratio = (a: Dec, b: Dec): number | null => {
  if (b.n === 0n) return null
  const [x, y] = align(a, b)
  return Number(x * 1_000_000n / y) / 1_000_000
}
const dirSign = (d: 'long' | 'short'): Dec => ({ n: d === 'long' ? 1n : -1n, s: 0 })

// --- données ----------------------------------------------------------------
const accounts: Account[] = []
let nextId = 1
const id = () => nextId++
let nextTradeId = 1

const starterTags: [TagKind, string][] = [
  ['session', 'Asie'], ['session', 'Londres'], ['session', 'New York'],
  ['timeframe', 'M1'], ['timeframe', 'M5'], ['timeframe', 'M15'], ['timeframe', 'H1'], ['timeframe', 'H4'], ['timeframe', 'D1'],
  ['market_condition', 'Range'], ['market_condition', 'Tendance'], ['market_condition', 'Forte volatilité'], ['market_condition', 'Actualité économique'],
  ['emotion', 'Calme'], ['emotion', 'Discipline'], ['emotion', 'Confiance'], ['emotion', 'Peur de rater (FOMO)'], ['emotion', 'Doute'],
  ['emotion', 'Stress'], ['emotion', 'Impatience'], ['emotion', 'Revanche'], ['emotion', 'Soulagement'],
  ['mistake', 'Sortie trop tôt'], ['mistake', 'Sortie trop tard'], ['mistake', 'Surtrading'], ['mistake', 'Trade de revanche'],
  ['mistake', 'Pas de plan'], ['mistake', 'Mauvaise gestion du risque'], ['mistake', 'Stop déplacé'],
]
const tags: Tag[] = starterTags.map(([kind, name]) => ({ id: id(), kind, name, archived: false }))
const instruments: Instrument[] = [
  { id: id(), symbol: 'EURUSD', assetClass: 'forex', defaultMultiplier: '100000' },
  { id: id(), symbol: 'XAUUSD', assetClass: 'commodity', defaultMultiplier: '100' },
  { id: id(), symbol: 'NAS100', assetClass: 'index', defaultMultiplier: '1' },
  { id: id(), symbol: 'BTCUSD', assetClass: 'crypto', defaultMultiplier: '1' },
]
const rules: Rule[] = []
const checklist: ChecklistItem[] = []
const cashFlows: CashFlow[] = []
const trades = new Map<number, TradeData & { id: number; createdAt: string; updatedAt: string }>()
const screenshots = new Map<string, string>()

const key = (s: string) => s.split(/\s+/).filter(Boolean).join(' ').toLowerCase()
const invalid = (m: string) => new Error(`invalid input: ${m}`)
const need = (v: string, what: string) => {
  const t = v.split(/\s+/).filter(Boolean).join(' ')
  if (!t) throw invalid(`${what} is required`)
  return t
}

function session(entryTime: number): string {
  const h = Math.floor(entryTime / 3_600_000) % 24
  const hour = (h + 24) % 24
  return hour >= 7 && hour <= 12 ? 'Londres' : hour >= 13 && hour <= 21 ? 'New York' : 'Asie'
}

function figuresOf(d: TradeData, multiplier: Decimal): Figures | null {
  if (d.exitPrice == null) return null
  const gross = mul(mul(mul(sub(parse(d.exitPrice), parse(d.entryPrice)), dirSign(d.direction)), parse(d.size)), parse(multiplier))
  const net = sub(gross, parse(d.fees))
  const risk = riskOf(d, multiplier)
  const outcome: Outcome = sign(net) > 0 ? 'win' : sign(net) < 0 ? 'loss' : 'breakeven'
  return {
    grossPnl: str(gross),
    fees: d.fees,
    netPnl: str(net),
    initialRisk: risk ? str(risk) : null,
    rMultiple: risk ? ratio(net, risk) : null,
    plannedRewardRisk: rewardRisk(d),
    outcome,
  }
}
function riskOf(d: TradeData, multiplier: Decimal): Dec | null {
  if (d.plannedSl == null) return null
  const perUnit = mul(sub(parse(d.entryPrice), parse(d.plannedSl)), dirSign(d.direction))
  return sign(perUnit) > 0 ? mul(mul(perUnit, parse(d.size)), parse(multiplier)) : null
}
function rewardRisk(d: TradeData): number | null {
  if (d.plannedSl == null || d.plannedTp == null) return null
  const risk = mul(sub(parse(d.entryPrice), parse(d.plannedSl)), dirSign(d.direction))
  const reward = mul(sub(parse(d.plannedTp), parse(d.entryPrice)), dirSign(d.direction))
  return sign(risk) > 0 && sign(reward) > 0 ? ratio(reward, risk) : null
}

function validate(d: TradeData): Decimal {
  const account = accounts.find((a) => a.id === d.accountId)
  if (!account) throw invalid('unknown account')
  const instrument = instruments.find((i) => i.id === d.instrumentId)
  if (!instrument) throw invalid('unknown instrument')
  if (sign(parse(d.size)) <= 0) throw invalid('size must be greater than zero')
  if ((d.exitPrice == null) !== (d.exitTime == null)) throw invalid('exit price and exit time go together')
  if (d.exitTime != null && d.exitTime < d.entryTime) throw invalid('exit time is before entry time')
  if (d.plannedSl != null) {
    const ok = sign(mul(sub(parse(d.entryPrice), parse(d.plannedSl)), dirSign(d.direction))) > 0
    if (!ok) {
      throw invalid(
        d.direction === 'long'
          ? 'the planned stop loss of a long must be below the entry price'
          : 'the planned stop loss of a short must be above the entry price',
      )
    }
  }
  const singles = new Set<TagKind>()
  for (const tid of d.tagIds) {
    const tag = tags.find((g) => g.id === tid)
    if (!tag) throw invalid('unknown tag')
    if (tag.kind === 'emotion') throw invalid(`${tag.name} is an emotion: set it in emotions`)
    if (tag.kind !== 'mistake') {
      if (singles.has(tag.kind)) throw invalid(`a trade has only one ${tag.kind.replace('_', ' ')} tag`)
      singles.add(tag.kind)
    }
  }
  return d.multiplier ?? instrument.defaultMultiplier
}

function view(t: TradeData & { id: number; createdAt: string; updatedAt: string }): TradeView {
  const instrument = instruments.find((i) => i.id === t.instrumentId)!
  const account = accounts.find((a) => a.id === t.accountId)!
  const multiplier = t.multiplier ?? instrument.defaultMultiplier
  const risk = riskOf(t, multiplier)
  const after =
    t.exitPrice != null && t.priceAfterExit != null
      ? str(mul(mul(mul(sub(parse(t.priceAfterExit), parse(t.exitPrice)), dirSign(t.direction)), parse(t.size)), parse(multiplier)))
      : null
  return {
    ...t,
    multiplier,
    symbol: instrument.symbol,
    assetClass: instrument.assetClass,
    accountName: account.name,
    currency: account.currency,
    figures: figuresOf(t, multiplier),
    initialRisk: risk ? str(risk) : null,
    durationMs: t.exitTime != null ? t.exitTime - t.entryTime : null,
    opportunityCost: after,
  }
}

/** Comptes sélectionnés (tous si vide), clôturés uniquement ; refuse de mélanger les devises comme pulse-core. */
function ledgerOf(accountIds: number[]): MockLedger {
  const chosen = accountIds.length ? accounts.filter((a) => accountIds.includes(a.id)) : accounts
  if (chosen.length === 0) return { currency: null, initialCapital: '0', capitalMoves: [], closed: [], openCount: 0 }
  const other = chosen.find((a) => a.currency !== chosen[0].currency)
  if (other) throw invalid(`accounts in different currencies (${chosen[0].currency} and ${other.currency}) cannot be combined`)
  const initial = chosen.reduce<Dec>((sum, a) => sub(sum, { n: -parse(a.initialCapital).n, s: parse(a.initialCapital).s }), { n: 0n, s: 0 })
  const views = [...trades.values()].filter((t) => chosen.some((a) => a.id === t.accountId)).map(view)
  return {
    currency: chosen[0].currency,
    initialCapital: str(initial),
    capitalMoves: cashFlows
      .filter((f) => chosen.some((a) => a.id === f.accountId))
      .map((f) => ({ at: f.occurredAt, amount: f.kind === 'deposit' ? f.amount : `-${f.amount}` })),
    closed: views.flatMap((v) =>
      v.figures && v.exitTime != null
        ? [{ id: v.id, symbol: v.symbol, direction: v.direction, exitTime: v.exitTime, tzOffsetMin: v.tzOffsetMin, netPnl: v.figures.netPnl, rMultiple: v.figures.rMultiple, outcome: v.figures.outcome }]
        : [],
    ),
    openCount: views.filter((v) => v.exitTime == null).length,
  }
}

export const mock = {
  appInfo: async () => ({ version: '0.1.0', dataDir: '(browser preview)', schemaVersion: 2 }),
  listAccounts: async (): Promise<Account[]> => [...accounts],
  deleteAccount: async (accountId: number): Promise<void> => {
    if ([...trades.values()].some((t) => t.accountId === accountId)) throw invalid('account_in_use')
    if (cashFlows.some((f) => f.accountId === accountId)) throw invalid('account_in_use')
    const i = accounts.findIndex((a) => a.id === accountId)
    if (i >= 0) accounts.splice(i, 1)
  },
  createAccount: async (a: NewAccount): Promise<Account> => {
    if (!a.name.trim()) throw new Error('invalid input: account name is required')
    if (!/^\d+(\.\d+)?$/.test(a.initialCapital.trim())) {
      throw new Error(`invalid input: initial capital is not a valid number: "${a.initialCapital}"`)
    }
    const acc = { ...a, name: a.name.trim(), initialCapital: a.initialCapital.trim(), id: id() }
    accounts.push(acc)
    return acc
  },
  listInstruments: async (): Promise<Instrument[]> => [...instruments].sort((a, b) => a.symbol.localeCompare(b.symbol)),
  createInstrument: async (n: NewInstrument): Promise<Instrument> => {
    const symbol = need(n.symbol, 'symbol')
    const k = symbol.replace(/[^A-Za-z0-9.]/g, '').toUpperCase()
    if (!k) throw invalid('symbol must contain letters or digits')
    if (sign(parse(n.defaultMultiplier)) <= 0) throw invalid('multiplier must be greater than zero')
    if (instruments.some((i) => i.symbol.replace(/[^A-Za-z0-9.]/g, '').toUpperCase() === k)) throw invalid(`instrument ${symbol} already exists`)
    const i = { ...n, symbol, id: id() }
    instruments.push(i)
    return i
  },
  listTags: async (kind?: TagKind | null, includeArchived = false): Promise<Tag[]> =>
    tags.filter((g) => (!kind || g.kind === kind) && (includeArchived || !g.archived)),
  createTag: async (kind: TagKind, name: string): Promise<Tag> => {
    const clean = need(name, 'tag name')
    if (tags.some((g) => g.kind === kind && key(g.name) === key(clean))) throw invalid(`tag ${clean} already exists`)
    const tag = { id: id(), kind, name: clean, archived: false }
    tags.push(tag)
    return tag
  },
  listRules: async (includeArchived = false): Promise<Rule[]> => rules.filter((r) => includeArchived || !r.archived),
  createRule: async (text: string): Promise<Rule> => {
    const r = { id: id(), text: need(text, 'rule'), archived: false, position: rules.length }
    rules.push(r)
    return r
  },
  renameRule: async (rid: number, text: string): Promise<Rule> => {
    const r = rules.find((x) => x.id === rid)
    if (!r) throw new Error(`not found: rule ${rid}`)
    r.text = need(text, 'rule')
    return { ...r }
  },
  setRuleArchived: async (rid: number, archived: boolean): Promise<Rule> => {
    const r = rules.find((x) => x.id === rid)
    if (!r) throw new Error(`not found: rule ${rid}`)
    r.archived = archived
    return { ...r }
  },
  listChecklist: async (includeArchived = false): Promise<ChecklistItem[]> => checklist.filter((c) => includeArchived || !c.archived),
  createChecklistItem: async (label: string): Promise<ChecklistItem> => {
    const c = { id: id(), label: need(label, 'checklist item'), archived: false, position: checklist.length }
    checklist.push(c)
    return c
  },
  renameChecklistItem: async (cid: number, label: string): Promise<ChecklistItem> => {
    const c = checklist.find((x) => x.id === cid)
    if (!c) throw new Error(`not found: checklist item ${cid}`)
    c.label = need(label, 'checklist item')
    return { ...c }
  },
  setChecklistItemArchived: async (cid: number, archived: boolean): Promise<ChecklistItem> => {
    const c = checklist.find((x) => x.id === cid)
    if (!c) throw new Error(`not found: checklist item ${cid}`)
    c.archived = archived
    return { ...c }
  },
  listCashFlows: async (accountId: number): Promise<CashFlow[]> =>
    cashFlows.filter((f) => f.accountId === accountId).sort((a, b) => a.occurredAt - b.occurredAt || a.id - b.id),
  createCashFlow: async (n: NewCashFlow): Promise<CashFlow> => {
    if (!accounts.some((a) => a.id === n.accountId)) throw new Error(`not found: account ${n.accountId}`)
    if (!/^\d+(\.\d+)?$/.test(n.amount) || sign(parse(n.amount)) <= 0) throw invalid('amount must be greater than zero')
    const f = { ...n, note: n.note.trim(), id: id() }
    cashFlows.push(f)
    return f
  },
  deleteCashFlow: async (fid: number): Promise<void> => {
    const i = cashFlows.findIndex((f) => f.id === fid)
    if (i < 0) throw new Error(`not found: deposit/withdrawal ${fid}`)
    cashFlows.splice(i, 1)
  },
  listTrades: async (filter?: TradeFilter | null): Promise<TradeView[]> =>
    [...trades.values()]
      .filter((t) => !filter?.accountIds?.length || filter.accountIds.includes(t.accountId))
      .filter((t) => filter?.from == null || t.entryTime >= filter.from)
      .filter((t) => filter?.to == null || t.entryTime < filter.to)
      .sort((a, b) => b.entryTime - a.entryTime || b.id - a.id)
      .map(view),
  getTrade: async (tid: number): Promise<TradeView> => {
    const t = trades.get(tid)
    if (!t) throw new Error(`not found: trade ${tid}`)
    return view(t)
  },
  createTrade: async (d: TradeData): Promise<TradeView> => {
    const multiplier = validate(d)
    const now = new Date().toISOString()
    const t = { ...d, multiplier, id: nextTradeId++, createdAt: now, updatedAt: now }
    trades.set(t.id, t)
    return view(t)
  },
  updateTrade: async (tid: number, d: TradeData): Promise<TradeView> => {
    const old = trades.get(tid)
    if (!old) throw new Error(`not found: trade ${tid}`)
    const multiplier = validate(d)
    const t = { ...d, multiplier, id: tid, createdAt: old.createdAt, updatedAt: new Date().toISOString() }
    trades.set(tid, t)
    return view(t)
  },
  deleteTrade: async (tid: number): Promise<void> => {
    if (!trades.delete(tid)) throw new Error(`not found: trade ${tid}`)
  },
  previewTrade: async (d: TradeData): Promise<Preview> => {
    const instrument = instruments.find((i) => i.id === d.instrumentId)
    if (!instrument) throw new Error('not found: instrument')
    const multiplier = d.multiplier ?? instrument.defaultMultiplier
    const risk = riskOf(d, multiplier)
    const account = accounts.find((a) => a.id === d.accountId)
    const cap = account ? parse(account.initialCapital) : null
    return {
      figures: figuresOf(d, multiplier),
      initialRisk: risk ? str(risk) : null,
      riskPctOfCapital: risk && cap && sign(cap) > 0 ? (ratio(risk, cap) ?? 0) * 100 : null,
      plannedRewardRisk: rewardRisk(d),
      durationMs: d.exitTime != null ? d.exitTime - d.entryTime : null,
      session: session(d.entryTime),
      stopLoss: d.plannedSl == null ? 'missing' : risk ? 'valid' : 'invalid',
      opportunityCost:
        d.exitPrice != null && d.priceAfterExit != null
          ? str(mul(mul(mul(sub(parse(d.priceAfterExit), parse(d.exitPrice)), dirSign(d.direction)), parse(d.size)), parse(multiplier)))
          : null,
    }
  },
  getDashboard: async (q: DashboardQuery) => mockDashboard(ledgerOf(q.accountIds), q),
  getCalendar: async (q: CalendarQuery) => mockCalendar(ledgerOf(q.accountIds), q),
  getDayTrades: async (accountIds: number[], day: string) => mockDayTrades(ledgerOf(accountIds), day),
  saveScreenshot: async (image: string): Promise<string> => {
    if (!image.startsWith('data:image/')) throw invalid('unsupported image format (use PNG, JPEG, WebP or GIF)')
    const path = `screenshots/mock-${id()}.png`
    screenshots.set(path, image)
    return path
  },
  readScreenshot: async (path: string): Promise<string> => {
    const s = screenshots.get(path)
    if (!s) throw new Error(`not found: screenshot ${path}`)
    return s
  },
}
