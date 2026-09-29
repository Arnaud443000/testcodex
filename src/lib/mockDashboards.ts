import { GRID_COLUMNS, type DashboardLayout, type DashboardSummary, type WidgetDefinition, type WidgetInstance } from '../types/dashboardLayout'
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
  def('r_distribution', 'breakdown', [15, 16], [10, 11], [], true, true),
  def('risk', 'breakdown', [15, 16], [10, 11], [], true, true),
  def('long_short', 'breakdown', [10, 14], [8, 10], [], true, true),
  def('recent_trades', 'tracking', [15, 16], [10, 8], ['5', '10', '15'], false, true),
  def('goals', 'tracking', [10, 14], [8, 8], [], false, true),
  def('discipline', 'behavior', [10, 20], [8, 14], [], true, true),
  def('emotions', 'behavior', [12, 18], [9, 12], ['before', 'during', 'after', 'any'], true, true),
  def('streaks', 'behavior', [8, 20], [7, 12], [], true, true),
  def('plan', 'behavior', [10, 20], [8, 12], [], true, true),
  def('first_trade', 'behavior', [10, 14], [8, 10], [], true, true),
  def('mistakes', 'behavior', [10, 18], [8, 10], [], true, true),
  def('rules', 'behavior', [10, 18], [8, 10], [], true, true),
  def('hesitation', 'behavior', [10, 14], [8, 10], [], true, true),
  def('factors', 'behavior', [20, 18], [12, 12], [], true, true),
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
      w('discipline', 'discipline', 0, 0, 10, 20),
      w('emotions', 'emotions', 10, 0, 12, 20, 'before'),
      w('streaks', 'streaks', 22, 0, 8, 20),
      w('plan', 'plan', 0, 20, 10, 20),
      w('mistakes', 'mistakes', 10, 20, 10, 20),
      w('rules', 'rules', 20, 20, 10, 20),
      w('first-trade', 'first_trade', 0, 40, 10, 14),
      w('hesitation', 'hesitation', 10, 40, 10, 14),
      w('goals', 'goals', 20, 40, 10, 14),
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
      w('r-distribution', 'r_distribution', 0, 40, 15, 16),
      w('risk', 'risk', 15, 40, 15, 16),
      w('recent', 'recent_trades', 0, 56, 30, 16),
    ],
  },
}

interface Stored {
  id: number
  name: string
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
  if (preset) return { key, name: preset.name, builtin: true, isDefault, widgets: clone(preset.widgets) }
  const c = findCustom(key)
  if (!c) throw notFound(`dashboard "${key}"`)
  return { key: customKey(c.id), name: c.name, builtin: false, isDefault, widgets: clone(c.widgets) }
}

const taken = (name: string, exceptId: number | null) =>
  customs.some((c) => c.id !== exceptId && c.name.trim().toLowerCase() === name.trim().toLowerCase())

export function createDashboardsMock(listAccountIds: () => Promise<number[]>) {
  return {
    listWidgetCatalog: async (): Promise<WidgetDefinition[]> => clone(LIBRARY),
    listDashboardLayouts: async (): Promise<DashboardSummary[]> => {
      const dflt = currentDefault()
      return [...PRESET_KEYS, ...customs.map((c) => customKey(c.id))].map((key) => {
        const l = layoutOf(key)
        return { key, name: l.name, builtin: l.builtin, isDefault: dflt === key, widgetCount: l.widgets.length }
      })
    },
    getDashboardLayout: async (key: string): Promise<DashboardLayout> => layoutOf(key),
    getStartupDashboard: async (): Promise<DashboardLayout> => layoutOf(currentDefault()),
    saveDashboardLayout: async (key: string | null, name: string, widgets: WidgetInstance[]): Promise<DashboardLayout> => {
      const cleaned = cleanName(name)
      validateLayout(widgets, await listAccountIds())
      const existing = key !== null ? findCustom(key) : undefined
      if (key !== null && !(key in PRESETS) && !existing) throw notFound(`dashboard "${key}"`)
      if (taken(cleaned, existing?.id ?? null)) throw invalid(`a dashboard named "${cleaned}" already exists`)
      if (existing) {
        existing.name = cleaned
        existing.widgets = clone(widgets)
        return layoutOf(customKey(existing.id))
      }
      const created: Stored = { id: nextId++, name: cleaned, widgets: clone(widgets) }
      customs.push(created)
      return layoutOf(customKey(created.id))
    },
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
    /** Pour les tests : repart d'un état neuf. */
    reset: () => {
      customs = []
      nextId = 1
      defaultKey = null
    },
  }
}
