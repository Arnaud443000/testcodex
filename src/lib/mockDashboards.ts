import {
  FOLLOW_SCOPE,
  GRID_COLUMNS,
  type DashboardLayout,
  type DashboardScope,
  type DashboardSummary,
  type ImportResult,
  type ImportWarning,
  type ResolvedDashboard,
  type ResolvedScope,
  type ScopeAccount,
  type ScopeNotice,
  type WidgetDefinition,
  type WidgetInstance,
  type WidgetScope,
} from '../types/dashboardLayout'
import type { PeriodKey } from '../types/stats'

/**
 * MOCK du dashboard personnalisable — uniquement pour `npm run dev` dans un navigateur.
 * Il reproduit les règles de pulse-core (dashboards.rs) : bibliothèque, presets, validation de la grille,
 * dashboard par défaut. Il ne fait pas foi : dans l'application tout vient de pulse-core.
 */

const MAX_ROWS = 300
const MAX_WIDGETS = 60
const MAX_NAME = 60
const PERIODS: PeriodKey[] = ['1D', '1W', '1M', '3M', '1Y', 'ALL']
export const ESSENTIAL = 'preset:essential'
const PRESET_KEYS = [ESSENTIAL, 'preset:behavior', 'preset:analysis']

const KPI_MODES = ['win_rate', 'profit_factor', 'expectancy', 'risk_reward', 'max_drawdown']
const def = (
  kind: string,
  category: WidgetDefinition['category'],
  [defaultW, defaultH]: [number, number],
  [minW, minH]: [number, number],
  modes: string[],
  period: boolean,
  account: boolean,
): WidgetDefinition => ({ kind, category, defaultW, defaultH, minW, minH, modes, period, account })

const LIBRARY: WidgetDefinition[] = [
  def('net_pnl_equity', 'performance', [20, 16], [12, 11], [], true, true),
  def('capital', 'performance', [10, 16], [7, 10], [], false, true),
  def('kpi', 'performance', [6, 6], [5, 5], KPI_MODES, true, true),
  def('daily_results', 'performance', [17, 13], [10, 9], [], true, true),
  def('calendar', 'temporal', [13, 13], [10, 11], [], false, true),
  def('heatmap', 'temporal', [20, 18], [14, 12], [], true, true),
  def('r_distribution', 'breakdown', [15, 14], [10, 11], [], true, true),
  def('risk', 'breakdown', [15, 14], [10, 11], [], true, true),
  def('long_short', 'breakdown', [10, 14], [8, 10], [], true, true),
  def('recent_trades', 'tracking', [15, 14], [10, 8], ['5', '10', '15'], false, true),
  def('goals', 'tracking', [10, 14], [8, 8], [], false, true),
  def('discipline', 'behavior', [10, 26], [8, 14], [], true, true),
  def('emotions', 'behavior', [12, 18], [9, 12], ['before', 'during', 'after', 'any'], true, true),
  def('streaks', 'behavior', [8, 26], [7, 12], [], true, true),
  def('plan', 'behavior', [10, 28], [8, 12], [], true, true),
  def('first_trade', 'behavior', [10, 18], [8, 10], [], true, true),
  def('mistakes', 'behavior', [10, 18], [8, 10], [], true, true),
  def('rules', 'behavior', [10, 18], [8, 10], [], true, true),
  def('hesitation', 'behavior', [10, 18], [8, 10], [], true, true),
  def('factors', 'behavior', [20, 18], [12, 12], [], true, true),
  // Insights (lot 19 bis) : fenêtres fixes du moteur, donc pas de période propre.
  def('insights', 'behavior', [12, 20], [8, 10], [], false, true),
]

const w = (uid: string, kind: string, x: number, y: number, wd: number, h: number, mode: string | null = null): WidgetInstance => ({
  uid, kind, x, y, w: wd, h, period: null, accountId: null, mode,
})

const PRESETS: Record<string, { name: string; widgets: WidgetInstance[] }> = {
  [ESSENTIAL]: {
    name: 'Essentiel',
    widgets: [
      w('hero', 'net_pnl_equity', 0, 0, 20, 16),
      w('capital', 'capital', 20, 0, 10, 16),
      w('kpi-win', 'kpi', 0, 16, 6, 6, 'win_rate'),
      w('kpi-pf', 'kpi', 6, 16, 6, 6, 'profit_factor'),
      w('kpi-exp', 'kpi', 12, 16, 6, 6, 'expectancy'),
      w('kpi-rr', 'kpi', 18, 16, 6, 6, 'risk_reward'),
      w('kpi-dd', 'kpi', 24, 16, 6, 6, 'max_drawdown'),
      w('daily', 'daily_results', 0, 22, 17, 13),
      w('calendar', 'calendar', 17, 22, 13, 13),
    ],
  },
  'preset:behavior': {
    name: 'Comportement',
    widgets: [
      w('discipline', 'discipline', 0, 0, 10, 26),
      w('emotions', 'emotions', 10, 0, 12, 26, 'before'),
      w('streaks', 'streaks', 22, 0, 8, 26),
      w('plan', 'plan', 0, 26, 10, 28),
      w('mistakes', 'mistakes', 10, 26, 10, 28),
      w('rules', 'rules', 20, 26, 10, 28),
      w('first-trade', 'first_trade', 0, 54, 10, 18),
      w('hesitation', 'hesitation', 10, 54, 10, 18),
      w('goals', 'goals', 20, 54, 10, 18),
    ],
  },
  'preset:analysis': {
    name: 'Analyse',
    widgets: [
      w('hero', 'net_pnl_equity', 0, 0, 30, 16),
      w('kpi-pf', 'kpi', 0, 16, 6, 6, 'profit_factor'),
      w('kpi-exp', 'kpi', 6, 16, 6, 6, 'expectancy'),
      w('kpi-rr', 'kpi', 12, 16, 6, 6, 'risk_reward'),
      w('kpi-win', 'kpi', 18, 16, 6, 6, 'win_rate'),
      w('kpi-dd', 'kpi', 24, 16, 6, 6, 'max_drawdown'),
      w('heatmap', 'heatmap', 0, 22, 20, 18),
      w('long-short', 'long_short', 20, 22, 10, 18),
      w('r-distribution', 'r_distribution', 0, 40, 15, 14),
      w('risk', 'risk', 15, 40, 15, 14),
      w('recent', 'recent_trades', 0, 54, 30, 14),
    ],
  },
}

interface Stored {
  id: number
  name: string
  scope: DashboardScope
  widgets: WidgetInstance[]
}
let customs: Stored[] = []
let nextId = 1
let defaultKey: string | null = null

const invalid = (m: string) => new Error(`invalid input: ${m}`)
const notFound = (m: string) => new Error(`not found: ${m}`)
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function cleanName(name: string): string {
  const cleaned = name.split(/\s+/).filter(Boolean).join(' ')
  if (!cleaned) throw invalid('a dashboard needs a name')
  if ([...cleaned].length > MAX_NAME) throw invalid(`a dashboard name is at most ${MAX_NAME} characters`)
  if (PRESET_KEYS.some((k) => PRESETS[k].name.toLowerCase() === cleaned.toLowerCase())) throw invalid(`"${cleaned}" is the name of a built-in dashboard`)
  return cleaned
}

/** Mêmes contrôles que `dashboards::validate`. `accountIds` vient du faux backend des comptes. */
export function validateLayout(widgets: WidgetInstance[], accountIds: number[]): void {
  if (widgets.length > MAX_WIDGETS) throw invalid(`a dashboard holds at most ${MAX_WIDGETS} widgets`)
  const uids = new Set<string>()
  for (const x of widgets) {
    if (!x.uid || x.uid.length > 40) throw invalid('a widget needs an identifier of 1 to 40 characters')
    if (uids.has(x.uid)) throw invalid(`two widgets share the identifier "${x.uid}"`)
    uids.add(x.uid)
    const d = LIBRARY.find((l) => l.kind === x.kind)
    if (!d) throw invalid(`unknown widget kind "${x.kind}"`)
    if (x.w < d.minW || x.h < d.minH) throw invalid(`widget "${x.kind}" is smaller than ${d.minW}x${d.minH}`)
    if (x.x < 0 || x.y < 0 || x.x + x.w > GRID_COLUMNS || x.y + x.h > MAX_ROWS) throw invalid(`widget "${x.uid}" is outside the grid (${GRID_COLUMNS} columns)`)
    if (x.period !== null) {
      if (!d.period) throw invalid(`widget "${x.kind}" has no period setting`)
      if (!PERIODS.includes(x.period)) throw invalid(`unknown period "${x.period}"`)
    }
    if (x.accountId !== null) {
      if (!d.account) throw invalid(`widget "${x.kind}" has no account setting`)
      if (!accountIds.includes(x.accountId)) throw notFound(`account ${x.accountId}`)
    }
    if (x.mode !== null && !d.modes.includes(x.mode)) throw invalid(`widget "${x.kind}" has no display mode "${x.mode}"`)
  }
  widgets.forEach((a, i) =>
    widgets.slice(i + 1).forEach((b) => {
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) throw invalid(`widgets "${a.uid}" and "${b.uid}" overlap`)
    }),
  )
}

const customKey = (id: number) => `custom:${id}`
const findCustom = (key: string): Stored | undefined => {
  const m = /^custom:(\d+)$/.exec(key)
  return m ? customs.find((c) => c.id === Number(m[1])) : undefined
}
const exists = (key: string) => key in PRESETS || findCustom(key) !== undefined
const currentDefault = () => (defaultKey !== null && exists(defaultKey) ? defaultKey : ESSENTIAL)

function layoutOf(key: string): DashboardLayout {
  const isDefault = currentDefault() === key
  const preset = PRESETS[key]
  if (preset) return { key, name: preset.name, builtin: true, isDefault, scope: { ...FOLLOW_SCOPE }, widgets: clone(preset.widgets) }
  const c = findCustom(key)
  if (!c) throw notFound(`dashboard "${key}"`)
  return { key: customKey(c.id), name: c.name, builtin: false, isDefault, scope: { ...c.scope }, widgets: clone(c.widgets) }
}

const taken = (name: string, exceptId: number | null) =>
  customs.some((c) => c.id !== exceptId && c.name.trim().toLowerCase() === name.trim().toLowerCase())

/** Mêmes contrôles que `dashboards::validate_scope`. */
function validateScope(scope: DashboardScope, accountIds: number[]): void {
  if (scope.kind === 'account') {
    if (scope.accountId === null) throw invalid('a dashboard linked to an account needs that account')
    if (!accountIds.includes(scope.accountId)) throw notFound(`account ${scope.accountId}`)
  } else if (scope.accountId !== null) throw invalid('only a dashboard linked to an account carries an account')
}

const scopeAccount = (a: ScopeAccount): ScopeAccount => ({ id: a.id, name: a.name, currency: a.currency, archived: a.archived })
const currencyOf = (accounts: ScopeAccount[]): [string | null, boolean] => {
  const first = accounts[0]?.currency ?? null
  return [first, accounts.some((a) => a.currency !== first)]
}
/** Comptes par id, ou tous les comptes actifs quand `ids` est vide (convention du moteur). */
const loadAccounts = (all: ScopeAccount[], ids: number[]): ScopeAccount[] =>
  (ids.length === 0 ? all.filter((a) => !a.archived) : ids.map((id) => all.find((a) => a.id === id)).filter((a): a is ScopeAccount => a !== undefined)).map(scopeAccount)

/** Miroir de `dashboards::resolve_scope`. */
export function resolveScopeOf(all: ScopeAccount[], scope: DashboardScope, selected: number | null): ResolvedScope {
  const notices: ScopeNotice[] = []
  let effective = scope.kind
  let accountIds: number[]
  if (scope.kind === 'account' && scope.accountId !== null && all.some((a) => a.id === scope.accountId)) accountIds = [scope.accountId]
  else if (scope.kind === 'account') {
    notices.push('accountDeleted')
    effective = 'follow'
    accountIds = selected === null ? [] : [selected]
  } else if (scope.kind === 'all') accountIds = []
  else accountIds = selected === null ? [] : [selected]
  const accounts = loadAccounts(all, accountIds)
  if (effective === 'account' && accounts.some((a) => a.archived)) notices.push('accountArchived')
  const [currency, mixedCurrency] = currencyOf(accounts)
  return { declared: scope.kind, effective, accountIds, accounts, currency, mixedCurrency, notices }
}

/** Miroir de `dashboards::resolve` : le compte du widget, puis la portée du dashboard, puis la barre du haut. */
export function resolveDashboardOf(all: ScopeAccount[], scope: DashboardScope, widgets: WidgetInstance[], selected: number | null): ResolvedDashboard {
  const dashboard = resolveScopeOf(all, scope, selected)
  const out: WidgetScope[] = widgets.map((x) => {
    if (x.accountId !== null) {
      const accounts = loadAccounts(all, [x.accountId])
      const [currency, mixedCurrency] = currencyOf(accounts)
      return { uid: x.uid, source: 'widget', accountIds: [x.accountId], accounts, currency, mixedCurrency, accountMissing: accounts.length === 0 }
    }
    return {
      uid: x.uid,
      source: dashboard.effective === 'follow' ? 'topBar' : 'dashboard',
      accountIds: [...dashboard.accountIds],
      accounts: dashboard.accounts.map(scopeAccount),
      currency: dashboard.currency,
      mixedCurrency: dashboard.mixedCurrency,
      accountMissing: false,
    }
  })
  return { scope: dashboard, widgets: out }
}

// --- Duplication, export et import (3.8.7) : mêmes règles que `dashboards/transfer.rs` ---------------

const FORMAT = 'pulse-dashboard'
const FORMAT_VERSION = 1
const MAX_FILE_BYTES = 1_000_000

const importFail = (code: string, detail?: string): Error => invalid(`dashboard_import:${code}${detail === undefined ? '' : `:${detail}`}`)

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isStr = (v: unknown): v is string => typeof v === 'string'

/** Comme `#[serde(deny_unknown_fields)]` : ni champ inconnu, ni champ obligatoire absent. */
function shape(v: unknown, required: string[], optional: string[]): Json {
  if (!isObject(v)) throw importFail('corrupt', 'not an object')
  for (const k of Object.keys(v)) if (!required.includes(k) && !optional.includes(k)) throw importFail('corrupt', `unknown field ${k}`)
  for (const k of required) if (!(k in v)) throw importFail('corrupt', `missing field ${k}`)
  return v
}

interface AccountRef {
  name: string
  currency: string
}
function accountRefOf(v: unknown): AccountRef | null {
  if (v === undefined || v === null) return null
  const o = shape(v, ['name', 'currency'], [])
  if (!isStr(o.name) || !isStr(o.currency)) throw importFail('corrupt', 'account')
  return { name: o.name, currency: o.currency }
}

/** Le compte de ce faux backend portant ce nom et cette devise ; `null` s'il n'y en a pas ou s'il y en a deux. */
function findAccount(all: ScopeAccount[], r: AccountRef): number | null {
  const norm = (x: string) => x.trim().toLowerCase()
  const hits = all.filter((a) => norm(a.name) === norm(r.name) && norm(a.currency) === norm(r.currency))
  return hits.length === 1 ? hits[0].id : null
}

/** Un nom libre parmi `base (suffixe)`, `base (suffixe 2)`… en gardant le total dans la limite. */
function freeName(base: string, suffix: string): string {
  const b = base.split(/\s+/).filter(Boolean).join(' ')
  for (let n = 1; ; n++) {
    const tail = n === 1 ? ` (${suffix})` : ` (${suffix} ${n})`
    const candidate = `${[...b].slice(0, Math.max(0, MAX_NAME - [...tail].length)).join('').trimEnd()}${tail}`
    let ok = true
    try {
      cleanName(candidate)
    } catch {
      ok = false
    }
    if (ok && !taken(candidate, null)) return candidate
  }
}

const savable = (scope: DashboardScope): DashboardScope => (scope.kind === 'account' && scope.accountId === null ? { ...FOLLOW_SCOPE } : { ...scope })

export function createDashboardsMock(listAccounts: () => Promise<ScopeAccount[]>) {
  const listAccountIds = async () => (await listAccounts()).map((a) => a.id)
  const files = new Map<string, string>()
  /** Les mêmes contrôles que `dashboards::import_config`, dans le même ordre ; rien n'est écrit en cas d'erreur. */
  const importText = async (input: string): Promise<ImportResult> => {
    const all = await sync()
    if (new TextEncoder().encode(input).length > MAX_FILE_BYTES) throw importFail('too_large')
    const text = input.startsWith('\ufeff') ? input.slice(1) : input
    if (text.trim() === '') throw importFail('empty')
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (e) {
      throw importFail('corrupt', e instanceof Error ? e.message : String(e))
    }
    if (!isObject(value) || value.format !== FORMAT) throw importFail('not_a_dashboard')
    const version = value.version
    if (typeof version === 'number' && Number.isInteger(version) && version > FORMAT_VERSION) throw importFail('too_new', String(version))
    if (!(typeof version === 'number' && Number.isInteger(version) && version >= 1)) throw importFail('corrupt', 'version')
    const file = shape(value, ['format', 'version', 'name', 'scope', 'widgets'], [])
    if (!isStr(file.name) || !Array.isArray(file.widgets)) throw importFail('corrupt', 'name or widgets')
    const fileScope = shape(file.scope, ['kind'], ['account'])
    if (fileScope.kind !== 'follow' && fileScope.kind !== 'account' && fileScope.kind !== 'all') throw importFail('corrupt', 'scope kind')
    const scopeAccount = accountRefOf(fileScope.account)

    const warnings: ImportWarning[] = []
    const base = file.name.split(/\s+/).filter(Boolean).join(' ')
    if (base === '' || [...base].length > MAX_NAME) throw importFail('invalid', 'name')
    let nameOk = !taken(base, null)
    try {
      cleanName(base)
    } catch {
      nameOk = false
    }
    let name = base
    if (!nameOk) {
      name = freeName(base, 'importé')
      warnings.push({ code: 'renamed', from: base, to: name })
    }

    let scope: DashboardScope
    if (fileScope.kind === 'account') {
      if (!scopeAccount) throw importFail('corrupt', 'scope')
      const id = findAccount(all, scopeAccount)
      if (id === null) {
        warnings.push({ code: 'unknownScopeAccount', name: scopeAccount.name })
        scope = { ...FOLLOW_SCOPE }
      } else scope = { kind: 'account', accountId: id }
    } else if (scopeAccount) throw importFail('corrupt', 'scope')
    else scope = { kind: fileScope.kind, accountId: null }

    const widgets: WidgetInstance[] = []
    for (const raw of file.widgets) {
      if (!isObject(raw) || !isStr(raw.kind)) throw importFail('corrupt', 'widget')
      if (!LIBRARY.some((d) => d.kind === raw.kind)) {
        warnings.push({ code: 'unknownWidget', kind: raw.kind })
        continue
      }
      const o = shape(raw, ['uid', 'kind', 'x', 'y', 'w', 'h'], ['period', 'mode', 'account'])
      if (!isStr(o.uid) || !isStr(o.kind) || !isInt(o.x) || !isInt(o.y) || !isInt(o.w) || !isInt(o.h)) throw importFail('corrupt', 'widget fields')
      if ((o.period !== undefined && o.period !== null && !isStr(o.period)) || (o.mode !== undefined && o.mode !== null && !isStr(o.mode))) throw importFail('corrupt', 'widget fields')
      const ref = accountRefOf(o.account)
      let accountId: number | null = null
      if (ref) {
        accountId = findAccount(all, ref)
        if (accountId === null) warnings.push({ code: 'unknownAccount', name: ref.name, widgetKind: o.kind })
      }
      widgets.push({ uid: o.uid, kind: o.kind, x: o.x, y: o.y, w: o.w, h: o.h, period: (o.period ?? null) as PeriodKey | null, accountId, mode: (o.mode ?? null) as string | null })
    }
    try {
      validateLayout(widgets, all.map((a) => a.id))
    } catch (e) {
      throw importFail('invalid', e instanceof Error ? e.message : String(e))
    }
    const created: Stored = { id: nextId++, name, scope, widgets: clone(widgets) }
    customs.push(created)
    return { layout: layoutOf(customKey(created.id)), warnings }
  }
  /** Ce que fait SQLite quand un compte est supprimé (ON DELETE SET NULL) : les widgets et la portée le lâchent. */
  const sync = async (): Promise<ScopeAccount[]> => {
    const all = await listAccounts()
    const ids = new Set(all.map((a) => a.id))
    for (const c of customs) {
      if (c.scope.accountId !== null && !ids.has(c.scope.accountId)) c.scope.accountId = null
      for (const x of c.widgets) if (x.accountId !== null && !ids.has(x.accountId)) x.accountId = null
    }
    return all
  }
  const save = async (key: string | null, name: string, widgets: WidgetInstance[], scope?: DashboardScope | null): Promise<DashboardLayout> => {
    await sync()
    const cleaned = cleanName(name)
    validateLayout(widgets, await listAccountIds())
    if (scope) validateScope(scope, await listAccountIds())
    const existing = key !== null ? findCustom(key) : undefined
    if (key !== null && !(key in PRESETS) && !existing) throw notFound(`dashboard "${key}"`)
    if (taken(cleaned, existing?.id ?? null)) throw invalid(`a dashboard named "${cleaned}" already exists`)
    if (existing) {
      existing.name = cleaned
      existing.widgets = clone(widgets)
      if (scope) existing.scope = { ...scope }
      return layoutOf(customKey(existing.id))
    }
    const created: Stored = { id: nextId++, name: cleaned, scope: scope ? { ...scope } : { ...FOLLOW_SCOPE }, widgets: clone(widgets) }
    customs.push(created)
    return layoutOf(customKey(created.id))
  }

  return {
    listWidgetCatalog: async (): Promise<WidgetDefinition[]> => clone(LIBRARY),
    listDashboardLayouts: async (): Promise<DashboardSummary[]> => {
      await sync()
      const dflt = currentDefault()
      return [...PRESET_KEYS, ...customs.map((c) => customKey(c.id))].map((key) => {
        const l = layoutOf(key)
        return { key, name: l.name, builtin: l.builtin, isDefault: dflt === key, scope: l.scope, widgetCount: l.widgets.length }
      })
    },
    getDashboardLayout: async (key: string): Promise<DashboardLayout> => (await sync(), layoutOf(key)),
    getStartupDashboard: async (): Promise<DashboardLayout> => (await sync(), layoutOf(currentDefault())),
    saveDashboardLayout: save,
    setDashboardScope: async (key: string, scope: DashboardScope): Promise<DashboardLayout> => {
      await sync()
      if (key in PRESETS) throw invalid('a built-in dashboard cannot be linked to an account: save a copy first')
      const c = findCustom(key)
      if (!c) throw notFound(`dashboard "${key}"`)
      validateScope(scope, await listAccountIds())
      c.scope = { ...scope }
      return layoutOf(key)
    },
    /** Les comptes réellement lus par le dashboard et par chaque widget (brouillon compris). */
    resolveDashboardScope: async (scope: DashboardScope, widgets: WidgetInstance[], selectedAccountId: number | null): Promise<ResolvedDashboard> =>
      resolveDashboardOf(await sync(), scope, widgets, selectedAccountId),
    renameDashboardLayout: async (key: string, name: string): Promise<DashboardLayout> => {
      if (key in PRESETS) throw invalid('a built-in dashboard cannot be renamed')
      const cleaned = cleanName(name)
      const c = findCustom(key)
      if (!c) throw notFound(`dashboard "${key}"`)
      if (taken(cleaned, c.id)) throw invalid(`a dashboard named "${cleaned}" already exists`)
      c.name = cleaned
      return layoutOf(key)
    },
    deleteDashboardLayout: async (key: string): Promise<void> => {
      if (key in PRESETS) throw invalid('a built-in dashboard cannot be deleted')
      const c = findCustom(key)
      if (!c) throw notFound(`dashboard "${key}"`)
      customs = customs.filter((x) => x !== c)
      if (defaultKey === key) defaultKey = null
    },
    setDefaultDashboardLayout: async (key: string): Promise<DashboardLayout> => {
      if (!exists(key)) throw notFound(`dashboard "${key}"`)
      defaultKey = key
      return layoutOf(key)
    },
    duplicateDashboardLayout: async (key: string, name: string | null = null): Promise<DashboardLayout> => {
      await sync()
      const source = layoutOf(key)
      const copy = name ?? freeName(source.name, 'copie')
      return save(null, copy, source.widgets, savable(source.scope))
    },
    /** Écrit le fichier de configuration dans un « disque » en mémoire (le navigateur n'a pas de fichiers). */
    exportDashboardConfig: async (key: string, path: string): Promise<void> => {
      const all = await sync()
      const layout = layoutOf(key)
      const scope = savable(layout.scope)
      const ref = (id: number | null): AccountRef | null => {
        const a = id === null ? undefined : all.find((x) => x.id === id)
        return a ? { name: a.name, currency: a.currency } : null
      }
      const file = {
        format: FORMAT,
        version: FORMAT_VERSION,
        name: layout.name,
        scope: { kind: scope.kind, account: ref(scope.accountId) },
        widgets: layout.widgets.map((w) => ({ uid: w.uid, kind: w.kind, x: w.x, y: w.y, w: w.w, h: w.h, period: w.period, mode: w.mode, account: ref(w.accountId) })),
      }
      files.set(path, `${JSON.stringify(file, null, 2)}\n`)
    },
    importDashboardConfig: async (path: string): Promise<ImportResult> => {
      const text = files.get(path)
      if (text === undefined) throw new Error(`io error: no such file: ${path}`)
      return importText(text)
    },
    /** Pour les tests : le contenu d'un fichier exporté. */
    readExportedFile: (path: string): string | null => files.get(path) ?? null,
    /** Pour les tests : importe un texte sans passer par un fichier. */
    importDashboardConfigText: async (text: string): Promise<ImportResult> => importText(text),
    /** Boîtes de dialogue simulées : « enregistrer sous » propose un chemin ; « ouvrir » rouvre le dernier fichier exporté. */
    pickExportPath: async (defaultName: string): Promise<string | null> => `(dossier de démonstration)/${defaultName}`,
    pickImportPath: async (): Promise<string | null> => [...files.keys()].at(-1) ?? '(dossier de démonstration)/aucun-fichier.json',
    /** Pour les tests : repart d'un état neuf. */
    reset: () => {
      customs = []
      nextId = 1
      defaultKey = null
      files.clear()
    },
  }
}
