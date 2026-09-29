import type { BackupInfo, RestoreResult } from '../types/data'
import type { Account, AccountUpdate, CashFlow, NewAccount, NewCashFlow } from '../types/account'
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
import type { CalendarQuery, DashboardQuery, StatsQuery } from '../types/stats'
import type { BehaviorSettings } from '../types/behavior'
import { mockCalendar, mockDashboard, mockDayTrades, type MockLedger } from './mockStats'
import * as behavior from './mockBehavior'
import { ASSET_CATALOG } from './assetCatalog'
import { checkGoal, isMonth, mockLadder, mockProgress, replayItem, replayPasses } from './mockGoalsReplayLogic'
import { dayOf, isBlankEntry, isIncompleteData, mockConfidenceReport, mockExecutionScore, mockQualityReport } from './mockJournalLogic'
import type { Goal, GoalProgress, NewGoal, ProgressQuery } from '../types/goals'
import type { ReplayCard, ReplayFilter, ReplayItem } from '../types/replay'
import type { DayOverview, JournalEntry, MissedTrade, MissedTradeData, PeriodQuery, ReminderDue, ReminderSettings } from '../types/journal'

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
// Même catalogue intégré que la migration v4 de pulse-core (généré depuis un fichier commun).
const instruments: Instrument[] = ASSET_CATALOG.map(([symbol, name, assetClass, defaultMultiplier]) => ({
  id: id(),
  symbol,
  name,
  assetClass,
  defaultMultiplier,
}))
const rules: Rule[] = []
const checklist: ChecklistItem[] = []
const cashFlows: CashFlow[] = []
const trades = new Map<number, TradeData & { id: number; createdAt: string; updatedAt: string }>()
let behaviorSettings: BehaviorSettings = { ...behavior.DEFAULT_BEHAVIOR_SETTINGS }
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

const accountHasHistory = (accountId: number) =>
  [...trades.values()].some((t) => t.accountId === accountId) || cashFlows.some((f) => f.accountId === accountId)
const withHistory = (a: Account): Account => ({ ...a, hasHistory: accountHasHistory(a.id) })

/** Comptes sélectionnés (tous les comptes actifs si vide), clôturés uniquement ; refuse de mélanger les devises comme pulse-core. */
function ledgerOf(accountIds: number[]): MockLedger {
  const chosen = accountIds.length ? accounts.filter((a) => accountIds.includes(a.id)) : accounts.filter((a) => !a.archived)
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

/** Comptes choisis pour l'analyse comportementale ; mêmes refus que pulse-core. */
function behaviorInput(accountIds: number[] = []): behavior.BehaviorInput {
  const chosen = accountIds.length ? accounts.filter((a) => accountIds.includes(a.id)) : accounts
  const other = chosen.find((a) => a.currency !== chosen[0].currency)
  if (other) throw invalid(`accounts in different currencies (${chosen[0].currency} and ${other.currency}) cannot be combined`)
  const ids = new Set(chosen.map((a) => a.id))
  return {
    accounts: chosen,
    cashFlows: cashFlows.filter((f) => ids.has(f.accountId)),
    trades: [...trades.values()].filter((t) => ids.has(t.accountId)).map(view),
    tags,
    rules,
    settings: behaviorSettings,
  }
}

// Sauvegardes du faux backend : instantanés en mémoire, indexés par « dossier ».
type Snapshot = ReturnType<typeof snapshot>
const backups = new Map<string, Snapshot>()
let nextBackup = 1
const snapshot = () =>
  structuredClone({
    accounts, tags, instruments, rules, checklist, cashFlows,
    trades: [...trades.entries()], screenshots: [...screenshots.entries()], nextId, nextTradeId,
  })
const infoOf = (path: string, s: Snapshot): BackupInfo => ({
  path, schemaVersion: 6, accounts: s.accounts.length, trades: s.trades.length, screenshots: s.screenshots.length,
})
function replaceWith(s: Snapshot) {
  const put = <T,>(target: T[], from: T[]) => target.splice(0, target.length, ...from)
  put(accounts, s.accounts); put(tags, s.tags); put(instruments, s.instruments)
  put(rules, s.rules); put(checklist, s.checklist); put(cashFlows, s.cashFlows)
  trades.clear(); s.trades.forEach(([k, v]) => trades.set(k, v))
  screenshots.clear(); s.screenshots.forEach(([k, v]) => screenshots.set(k, v))
  nextId = s.nextId; nextTradeId = s.nextTradeId
}

export const mock = {
  pickFolder: async (): Promise<string | null> => '(dossier de démonstration)',
  pickCsvPath: async (defaultName: string): Promise<string | null> => `(dossier de démonstration)/${defaultName}`,
  exportTradesCsv: async (_path: string): Promise<number> => trades.size,
  createBackup: async (destDir: string): Promise<BackupInfo> => {
    const path = `${destDir}/pulse-backup-${nextBackup++}`
    const s = snapshot()
    backups.set(path, s)
    return infoOf(path, s)
  },
  inspectBackup: async (folder: string): Promise<BackupInfo> => {
    const s = backups.get(folder)
    if (!s) throw invalid('this folder does not contain a pulse.db file')
    return infoOf(folder, s)
  },
  restoreBackup: async (folder: string, confirmed: boolean): Promise<RestoreResult> => {
    if (!confirmed) throw invalid('the restore was not confirmed')
    const s = backups.get(folder)
    if (!s) throw invalid('this folder does not contain a pulse.db file')
    const safetyCopy = `(dossier de démonstration)/pulse-avant-restauration-${nextBackup++}.db`
    backups.set(safetyCopy, snapshot())
    replaceWith(structuredClone(s))
    return { info: infoOf(folder, s), safetyCopy }
  },
  appInfo: async () => ({ version: '0.1.0', dataDir: '(browser preview)', schemaVersion: 2 }),
  listAccounts: async (): Promise<Account[]> => accounts.map(withHistory),
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
    const acc = { ...a, name: a.name.trim(), initialCapital: a.initialCapital.trim(), id: id(), archived: false, hasHistory: false }
    accounts.push(acc)
    return acc
  },
  updateAccount: async (accountId: number, u: AccountUpdate): Promise<Account> => {
    const acc = accounts.find((a) => a.id === accountId)
    if (!acc) throw new Error(`not found: account ${accountId}`)
    if (!u.name.trim()) throw invalid('account name is required')
    if (!u.currency.trim()) throw invalid('currency is required')
    if (!/^\d+(\.\d+)?$/.test(u.initialCapital.trim())) throw invalid(`initial capital is not a valid number: "${u.initialCapital}"`)
    if (accountHasHistory(accountId) && u.currency.trim() !== acc.currency) throw invalid('currency_locked')
    Object.assign(acc, { name: u.name.trim(), kind: u.kind, broker: u.broker.trim(), currency: u.currency.trim(), initialCapital: u.initialCapital.trim() })
    return withHistory(acc)
  },
  setAccountArchived: async (accountId: number, archived: boolean): Promise<Account> => {
    const acc = accounts.find((a) => a.id === accountId)
    if (!acc) throw new Error(`not found: account ${accountId}`)
    acc.archived = archived
    return withHistory(acc)
  },
  listInstruments: async (): Promise<Instrument[]> => [...instruments].sort((a, b) => a.symbol.localeCompare(b.symbol)),
  createInstrument: async (n: NewInstrument): Promise<Instrument> => {
    const symbol = need(n.symbol, 'symbol')
    const k = symbol.replace(/[^A-Za-z0-9.]/g, '').toUpperCase()
    if (!k) throw invalid('symbol must contain letters or digits')
    if (sign(parse(n.defaultMultiplier)) <= 0) throw invalid('multiplier must be greater than zero')
    if (instruments.some((i) => i.symbol.replace(/[^A-Za-z0-9.]/g, '').toUpperCase() === k)) throw invalid(`instrument ${symbol} already exists`)
    const i = { ...n, symbol, name: (n.name ?? '').split(/\s+/).filter(Boolean).join(' '), id: id() }
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
    const target = accounts.find((a) => a.id === n.accountId)
    if (!target) throw new Error(`not found: account ${n.accountId}`)
    if (target.archived) throw invalid('account_archived')
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
      .filter((t) => (filter?.accountIds?.length ? filter.accountIds.includes(t.accountId) : !accounts.find((a) => a.id === t.accountId)?.archived))
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
    if (accounts.find((a) => a.id === d.accountId)?.archived) throw invalid('account_archived')
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
  getBehaviorSettings: async (): Promise<BehaviorSettings> => ({ ...behaviorSettings }),
  setBehaviorSettings: async (s: BehaviorSettings): Promise<BehaviorSettings> => {
    const percent = s.maxRiskPercent === null ? null : parse(s.maxRiskPercent)
    if (percent && (sign(percent) <= 0 || sign(sub(percent, parse('100'))) > 0)) throw invalid('the maximum risk per trade must be between 0 and 100 %')
    if (s.maxTradesPerDay !== null && s.maxTradesPerDay < 1) throw invalid('the maximum number of trades per day must be at least 1')
    if (s.revengeWindowMin < 1 || s.revengeWindowMin > 1440) throw invalid('the revenge window must be between 1 minute and 24 hours')
    if (sign(sub(parse(s.revengeSizeFactor), parse('1'))) < 0) throw invalid('the revenge size factor must be at least 1')
    behaviorSettings = { ...s }
    return { ...behaviorSettings }
  },
  getDiscipline: async (q: StatsQuery) => behavior.mockDiscipline(behaviorInput(q.accountIds), q),
  getTradeDiscipline: async (tid: number) => {
    const t = trades.get(tid)
    if (!t) throw new Error(`not found: trade ${tid}`)
    return behavior.mockTradeDiscipline(behaviorInput([t.accountId]), tid)
  },
  getEmotions: async (q: StatsQuery) => behavior.mockEmotions(behaviorInput(q.accountIds), q),
  getStreaks: async (q: StatsQuery) => behavior.mockStreaks(behaviorInput(q.accountIds), q),
  getPlanComparison: async (q: StatsQuery) => behavior.mockPlan(behaviorInput(q.accountIds), q),
  getFirstTrade: async (q: StatsQuery) => behavior.mockFirstTrade(behaviorInput(q.accountIds), q),
  getMistakes: async (q: StatsQuery) => behavior.mockMistakes(behaviorInput(q.accountIds), q),
  getRuleAdherence: async (q: StatsQuery) => behavior.mockRuleAdherence(behaviorInput(q.accountIds), q),
  getPatterns: async (q: StatsQuery) => behavior.mockPatterns(behaviorInput(q.accountIds), q),
  getRDistribution: async (q: StatsQuery) => behavior.mockRDistribution(behaviorInput(q.accountIds), q),
  getHeatmap: async (q: StatsQuery) => behavior.mockHeatmap(behaviorInput(q.accountIds), q),
  getLongShort: async (q: StatsQuery) => behavior.mockLongShort(behaviorInput(q.accountIds), q),
  getRisk: async (q: StatsQuery) => behavior.mockRisk(behaviorInput(q.accountIds), q),
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

// --- Lot 10 : journal quotidien, trades manqués, qualité d'exécution, confiance, rappel ---
const missedTrades: MissedTrade[] = []
const journalEntries = new Map<string, JournalEntry>()
let reminderSettings: ReminderSettings = { enabled: true, time: '20:00' }
let reminderLastSent: string | null = null
let nextMissedId = 1

const scoped = (accountIds?: number[]) => (accountIds?.length ? accountIds : accounts.map((a) => a.id))
const viewsOf = (accountIds?: number[]) => [...trades.values()].filter((t) => scoped(accountIds).includes(t.accountId)).map(view)
const checkDay = (day: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day)
    throw invalid(`invalid day "${day}"`)
}
const checkScale = (what: string, v: number | null | undefined, max: number) => {
  if (v != null && (!Number.isInteger(v) || v < 1 || v > max)) throw invalid(`${what} must be between 1 and ${max}`)
}
function validateMissed(d: MissedTradeData) {
  if (!accounts.some((a) => a.id === d.accountId)) throw invalid('unknown account')
  if (!instruments.some((i) => i.id === d.instrumentId)) throw invalid('unknown instrument')
  checkScale('conviction', d.conviction, 10)
  for (const tid of new Set(d.tagIds)) {
    const tag = tags.find((g) => g.id === tid)
    if (!tag) throw invalid('unknown tag')
    if (tag.kind === 'emotion' || tag.kind === 'mistake') throw invalid(`${tag.name} cannot qualify a missed trade`)
  }
}
const cleanMissed = (d: MissedTradeData): MissedTradeData => ({
  ...d,
  direction: d.direction ?? null,
  conviction: d.conviction ?? null,
  reason: d.reason.trim(),
  notes: d.notes.trim(),
  tagIds: [...new Set(d.tagIds)].sort((a, b) => a - b),
})
/** Heure locale « maintenant » du faux backend, comme le fait le rappel de pulse-core. */
function pendingWork(tz: number): ReminderDue | null {
  const now = Date.now()
  const day = dayOf(now, tz)
  const todays = viewsOf().filter((v) => dayOf(v.entryTime, v.tzOffsetMin) === day)
  if (todays.length === 0) return null
  const journalMissing = !journalEntries.has(day)
  const incompleteCount = todays.filter(isIncompleteData).length
  return journalMissing || incompleteCount > 0 ? { day, tradeCount: todays.length, incompleteCount, journalMissing } : null
}

export const mockJournal = {
  listMissedTrades: async (accountIds: number[]): Promise<MissedTrade[]> =>
    missedTrades
      .filter((m) => !accountIds.length || accountIds.includes(m.accountId))
      .sort((a, b) => b.occurredAt - a.occurredAt || b.id - a.id),
  createMissedTrade: async (d: MissedTradeData): Promise<MissedTrade> => {
    validateMissed(d)
    const m = { ...cleanMissed(d), id: nextMissedId++ }
    missedTrades.push(m)
    return m
  },
  updateMissedTrade: async (mid: number, d: MissedTradeData): Promise<MissedTrade> => {
    const i = missedTrades.findIndex((m) => m.id === mid)
    if (i < 0) throw new Error(`not found: missed trade ${mid}`)
    validateMissed(d)
    missedTrades[i] = { ...cleanMissed(d), id: mid }
    return missedTrades[i]
  },
  deleteMissedTrade: async (mid: number): Promise<void> => {
    const i = missedTrades.findIndex((m) => m.id === mid)
    if (i < 0) throw new Error(`not found: missed trade ${mid}`)
    missedTrades.splice(i, 1)
  },
  saveJournalEntry: async (e: JournalEntry): Promise<JournalEntry | null> => {
    checkDay(e.day)
    checkScale('mood', e.mood, 5)
    checkScale('sleep quality', e.sleepQuality, 5)
    checkScale('fatigue', e.fatigue, 5)
    if (isBlankEntry(e)) {
      journalEntries.delete(e.day)
      return null
    }
    const saved = { ...e, mood: e.mood ?? null, sleepQuality: e.sleepQuality ?? null, fatigue: e.fatigue ?? null, wentWell: e.wentWell.trim(), toImprove: e.toImprove.trim(), notes: e.notes.trim() }
    journalEntries.set(e.day, saved)
    return saved
  },
  getJournalDay: async (accountIds: number[], day: string): Promise<DayOverview> => {
    checkDay(day)
    const lines = viewsOf(accountIds)
      .filter((v) => dayOf(v.entryTime, v.tzOffsetMin) === day)
      .sort((a, b) => a.entryTime - b.entryTime || a.id - b.id)
      .map((v) => ({
        tradeId: v.id,
        symbol: v.symbol,
        direction: v.direction,
        currency: v.currency,
        entryTime: v.entryTime,
        netPnl: v.figures?.netPnl ?? null,
        outcome: v.figures?.outcome ?? null,
        incomplete: isIncompleteData(v),
      }))
    return { day, entry: journalEntries.get(day) ?? null, trades: lines, incompleteCount: lines.filter((l) => l.incomplete).length }
  },
  listJournalEntries: async (from?: string | null, to?: string | null): Promise<JournalEntry[]> =>
    [...journalEntries.values()].filter((e) => (!from || e.day >= from) && (!to || e.day <= to)).sort((a, b) => b.day.localeCompare(a.day)),
  deleteJournalEntry: async (day: string): Promise<void> => {
    journalEntries.delete(day)
  },
  getExecutionScore: async (tid: number) => {
    const t = trades.get(tid)
    if (!t) throw new Error(`not found: trade ${tid}`)
    return mockExecutionScore(t)
  },
  getQualityReport: async (q: PeriodQuery) => mockQualityReport(viewsOf(q.accountIds), q),
  getConfidenceReport: async (q: PeriodQuery) =>
    mockConfidenceReport(viewsOf(q.accountIds), missedTrades.filter((m) => scoped(q.accountIds).includes(m.accountId)), q),
  getReminderSettings: async (): Promise<ReminderSettings> => ({ ...reminderSettings }),
  setReminderSettings: async (s: ReminderSettings): Promise<ReminderSettings> => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) throw invalid(`reminder time must look like 20:00, got "${s.time}"`)
    reminderSettings = { ...s }
    return { ...reminderSettings }
  },
  /** Dans le navigateur, aucune notification native : la bannière suit l'heure du rappel. */
  getReminderPending: async (tz: number): Promise<ReminderDue | null> => {
    const now = new Date(Date.now() + tz * 60_000)
    const minutes = now.getUTCHours() * 60 + now.getUTCMinutes()
    const [h, m] = reminderSettings.time.split(':').map(Number)
    if (!reminderSettings.enabled || minutes < h * 60 + m) return null
    reminderLastSent = dayOf(Date.now(), tz)
    return reminderLastSent ? pendingWork(tz) : null
  },
}

// --- Lot 11 : objectifs mensuels et replay ---
const goals: Goal[] = []
let nextGoalId = 1

export const mockGoalsReplay = {
  listGoals: async (month: string): Promise<Goal[]> => {
    if (!isMonth(month)) throw invalid(`invalid month "${month}" (expected YYYY-MM)`)
    return goals.filter((g) => g.month === month)
  },
  setGoal: async (n: NewGoal): Promise<Goal> => {
    checkGoal(n.month, n.metric, n.target)
    const existing = goals.find((g) => g.month === n.month && g.metric === n.metric)
    if (existing) {
      existing.target = n.target
      return { ...existing }
    }
    const g = { id: nextGoalId++, month: n.month, metric: n.metric, target: n.target }
    goals.push(g)
    return { ...g }
  },
  deleteGoal: async (gid: number): Promise<void> => {
    const i = goals.findIndex((g) => g.id === gid)
    if (i < 0) throw new Error(`not found: goal ${gid}`)
    goals.splice(i, 1)
  },
  copyGoals: async (from: string, to: string): Promise<Goal[]> => {
    if (!isMonth(from) || !isMonth(to)) throw invalid('invalid month (expected YYYY-MM)')
    for (const g of goals.filter((x) => x.month === from)) {
      if (!goals.some((x) => x.month === to && x.metric === g.metric)) goals.push({ id: nextGoalId++, month: to, metric: g.metric, target: g.target })
    }
    return goals.filter((g) => g.month === to)
  },
  getGoalProgress: async (q: ProgressQuery): Promise<GoalProgress[]> => {
    if (!isMonth(q.month)) throw invalid(`invalid month "${q.month}" (expected YYYY-MM)`)
    const list = goals.filter((g) => g.month === q.month).sort((a, b) => a.id - b.id)
    if (list.length === 0) return []
    const [year, month] = q.month.split('-').map(Number)
    const cal = mockCalendar(ledgerOf(q.accountIds), { accountIds: q.accountIds, year, month, tzOffsetMin: q.tzOffsetMin })
    const from = Date.UTC(year, month - 1, 1) - q.tzOffsetMin * 60_000
    const to = Date.UTC(year, month, 1) - q.tzOffsetMin * 60_000
    const quality = mockQualityReport(viewsOf(q.accountIds), { accountIds: q.accountIds, from, to })
    return mockProgress(list, cal.summary, cal.currency, quality.averageStars, q.month, q.today)
  },
  listReplay: async (filter?: ReplayFilter | null): Promise<ReplayItem[]> =>
    viewsOf(filter?.accountIds)
      .filter((v) => replayPasses(v, filter ?? {}))
      .sort((a, b) => b.entryTime - a.entryTime || b.id - a.id)
      .map(replayItem),
  getReplayCard: async (tid: number): Promise<ReplayCard> => {
    const t = trades.get(tid)
    if (!t) throw new Error(`not found: trade ${tid}`)
    const v = view(t)
    return { trade: v, levels: mockLadder(v) }
  },
}

// --- Lot 8 bis : compléments de l'analyse comportementale ---
export const mockBehaviorExtra = {
  getExternalFactors: async (q: StatsQuery) => behavior.mockExternalFactors(behaviorInput(q.accountIds), q, [...journalEntries.values()]),
  getAfterLosses: async (q: StatsQuery) => behavior.mockAfterLosses(behaviorInput(q.accountIds), q),
  getSizeChange: async (q: StatsQuery) => behavior.mockSizeChange(behaviorInput(q.accountIds), q),
  getPlanSimulation: async (q: StatsQuery) => behavior.mockPlanSimulation(behaviorInput(q.accountIds), q),
}
