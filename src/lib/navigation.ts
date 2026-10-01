import type { Messages } from '../i18n'
import type { IconName } from '../components/Icon'

export type NavKey = Exclude<keyof Messages['nav'], 'groups' | 'label'>
export type NavGroupKey = keyof Messages['nav']['groups']

export interface NavItem {
  to: string
  key: NavKey
  icon: IconName
  /** Autres adresses qui « appartiennent » à cette entrée (elle reste allumée). */
  alsoActiveOn?: string[]
}

export interface NavGroup {
  /** `null` : entrée isolée en tête de liste (pas de titre de groupe). */
  key: NavGroupKey | null
  items: NavItem[]
}

/**
 * Regroupement de la barre latérale (lot 26) : Saisir → Analyser → Comprendre → Outils.
 * « Paramètres » est épinglé en bas (toujours visible, même en petite fenêtre) : voir `SETTINGS_ITEM`.
 * Les adresses n'ont pas changé : seul l'ordre et le regroupement sont nouveaux.
 */
export const NAV_GROUPS: NavGroup[] = [
  { key: null, items: [{ to: '/', key: 'dashboard', icon: 'dashboard' }] },
  {
    key: 'capture',
    items: [
      { to: '/analysis', key: 'analysis', icon: 'analysis' },
      { to: '/trades', key: 'trades', icon: 'trades' },
      { to: '/journal', key: 'journal', icon: 'journal' },
    ],
  },
  {
    key: 'analyse',
    items: [
      { to: '/calendar', key: 'calendar', icon: 'calendar' },
      { to: '/analytics', key: 'analytics', icon: 'analytics' },
      { to: '/comparisons', key: 'comparisons', icon: 'comparisons' },
    ],
  },
  {
    key: 'understand',
    items: [
      { to: '/behavior', key: 'behavior', icon: 'behavior' },
      { to: '/discipline', key: 'discipline', icon: 'discipline' },
      { to: '/insights', key: 'insights', icon: 'insights' },
      // Lot 36 : bilan hebdomadaire.
      { to: '/review', key: 'review', icon: 'review' },
      { to: '/coach', key: 'coach', icon: 'coach' },
    ],
  },
  {
    key: 'tools',
    items: [
      { to: '/goals', key: 'goals', icon: 'goals' },
      { to: '/replay', key: 'replay', icon: 'replay' },
      { to: '/sizing', key: 'sizing', icon: 'calculator' },
      // Lot 33 : suivi d'un compte prop firm.
      { to: '/prop', key: 'prop', icon: 'shield' },
    ],
  },
]

/** L'historique des alertes (`/alerts`) se règle dans Paramètres : l'entrée reste allumée. */
export const SETTINGS_ITEM: NavItem = { to: '/settings', key: 'settings', icon: 'settings', alsoActiveOn: ['/alerts'] }

/** Toutes les entrées, dans l'ordre d'affichage (Paramètres en dernier). */
export const NAV: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM]

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`)

/** Cette entrée est-elle « la page courante » ? Le tableau de bord (`/`) ne s'allume que sur `/`. */
export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.to === '/') return pathname === '/'
  return under(pathname, item.to) || (item.alsoActiveOn ?? []).some((base) => under(pathname, base))
}
