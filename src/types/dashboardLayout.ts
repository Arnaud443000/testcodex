import type { PeriodKey } from './stats'

/** Miroir de pulse-core::dashboards (dashboard personnalisable, lot 13). */

/** Largeur de la grille de disposition, en colonnes. */
export const GRID_COLUMNS = 30

export type WidgetCategory = 'performance' | 'temporal' | 'breakdown' | 'tracking' | 'behavior'

/** Un widget de la bibliothèque (3.8.3) : de quoi le proposer et le dimensionner. */
export interface WidgetDefinition {
  kind: string
  category: WidgetCategory
  defaultW: number
  defaultH: number
  minW: number
  minH: number
  /** Modes d'affichage, le premier est celui par défaut ; vide = aucun. */
  modes: string[]
  /** Le widget accepte sa propre période. */
  period: boolean
  /** Le widget peut être fixé sur un compte. */
  account: boolean
}

/** Un widget posé sur un dashboard (2.9). Position et taille en unités de grille. */
export interface WidgetInstance {
  uid: string
  kind: string
  x: number
  y: number
  w: number
  h: number
  /** Période propre ; `null` = celle de la barre du haut. */
  period: PeriodKey | null
  /** Compte propre ; `null` = celui de la barre du haut. */
  accountId: number | null
  /** Mode d'affichage ; `null` = le mode par défaut du widget. */
  mode: string | null
}

export interface DashboardLayout {
  /** `preset:…` ou `custom:<id>`. */
  key: string
  name: string
  /** Un preset livré avec l'application : en lecture seule. */
  builtin: boolean
  isDefault: boolean
  /** Ce que lit le dashboard par défaut (3.8.9). */
  scope: DashboardScope
  widgets: WidgetInstance[]
}

export interface DashboardSummary {
  key: string
  name: string
  builtin: boolean
  isDefault: boolean
  scope: DashboardScope
  widgetCount: number
}

/** Portée d'un dashboard (3.8.9) : la barre du haut, un seul compte, ou tous les comptes actifs. */
export type ScopeKind = 'follow' | 'account' | 'all'

export interface DashboardScope {
  kind: ScopeKind
  /** Renseigné pour `account` ; `null` avec `account` = le compte lié a été supprimé. */
  accountId: number | null
}

export const FOLLOW_SCOPE: DashboardScope = { kind: 'follow', accountId: null }

/** Miroir de `dashboards::ResolvedDashboard` : les comptes réellement lus, calculés par pulse-core. */
export interface ScopeAccount {
  id: number
  name: string
  currency: string
  archived: boolean
}

export type ScopeNotice = 'accountDeleted' | 'accountArchived'
/** D'où vient le compte lu par un widget : le sien, celui du dashboard, ou la barre du haut. */
export type ScopeSource = 'widget' | 'dashboard' | 'topBar'

export interface ResolvedScope {
  declared: ScopeKind
  effective: ScopeKind
  /** Vide = tous les comptes actifs. */
  accountIds: number[]
  accounts: ScopeAccount[]
  currency: string | null
  mixedCurrency: boolean
  notices: ScopeNotice[]
}

export interface WidgetScope {
  uid: string
  source: ScopeSource
  accountIds: number[]
  accounts: ScopeAccount[]
  currency: string | null
  mixedCurrency: boolean
  accountMissing: boolean
}

export interface ResolvedDashboard {
  scope: ResolvedScope
  widgets: WidgetScope[]
}

/** Miroir de `dashboards::ImportWarning` (lot 18, 3.8.7) : ce que l'import a changé ou ignoré sans échouer. */
export type ImportWarning =
  | { code: 'unknownWidget'; kind: string }
  | { code: 'unknownAccount'; name: string; widgetKind: string }
  | { code: 'unknownScopeAccount'; name: string }
  | { code: 'renamed'; from: string; to: string }

export interface ImportResult {
  layout: DashboardLayout
  warnings: ImportWarning[]
}

/** Codes d'erreur d'un import refusé (`dashboard_import:<code>[:détail]`) ; rien n'est alors écrit. */
export type ImportErrorCode = 'empty' | 'corrupt' | 'not_a_dashboard' | 'too_new' | 'too_large' | 'invalid'
