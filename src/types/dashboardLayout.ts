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
  widgets: WidgetInstance[]
}

export interface DashboardSummary {
  key: string
  name: string
  builtin: boolean
  isDefault: boolean
  widgetCount: number
}
