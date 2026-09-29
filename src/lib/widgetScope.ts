import type { Account } from '../types/account'
import type { PeriodKey, StatsQuery } from '../types/stats'
import type { ScopeSource, WidgetInstance, WidgetScope } from '../types/dashboardLayout'
import { periodRange } from './period'

/** Ce que les widgets partagent : la barre du haut et l'horloge de la page. */
export interface ScopeEnv {
  /** Comptes actifs (choix « tous les comptes »). */
  accounts: Account[]
  /** Tous les comptes, archivés compris (un compte choisi explicitement peut être archivé). */
  allAccounts: Account[]
  selectedId: number | null
  period: PeriodKey
  /** Instant de référence, figé à l'ouverture de la page pour que toutes les requêtes soient identiques. */
  nowMs: number
  tzOffsetMin: number
  /**
   * Comptes réellement lus par chaque widget, calculés par pulse-core (`resolve_dashboard_scope`) : le compte du
   * widget, puis la portée du dashboard, puis la barre du haut. Absent = pas de portée de dashboard (aperçu de
   * la bibliothèque, tests) : on retombe sur « le widget, puis la barre du haut ». Présent mais sans l'`uid` du
   * widget = pas encore résolu.
   */
  resolved?: Record<string, WidgetScope>
}

/** Ce qu'un widget lit réellement : ses propres réglages (3.8.8), à défaut ceux de la barre du haut. */
export interface Scope {
  /** Vide = tous les comptes actifs (convention de pulse-core). */
  accountIds: number[]
  chosen: Account[]
  period: PeriodKey
  nowMs: number
  tzOffsetMin: number
  /** Devise commune des comptes lus ('USD' sans compte). */
  currency: string
  /** Les comptes lus n'ont pas tous la même devise : rien ne peut être additionné. */
  mixed: boolean
  /** Le compte fixé sur le widget n'existe plus. */
  accountMissing: boolean
  periodOverridden: boolean
  /** Nom du compte quand il est fixé sur le widget. */
  ownAccountName: string | null
  /** D'où vient le compte lu : le widget, le dashboard, ou la barre du haut. */
  source: ScopeSource
}

export function resolveScope(own: Pick<WidgetInstance, 'period' | 'accountId'> & { uid?: string }, env: ScopeEnv): Scope {
  const periodOverridden = own.period !== null
  const period = own.period ?? env.period
  const known = own.uid !== undefined ? env.resolved?.[own.uid] : undefined
  if (known) {
    // Le calcul des comptes est fait par pulse-core ; ici on ne fait que mettre les résultats en forme.
    const chosen = known.accounts.map((a) => env.allAccounts.find((x) => x.id === a.id)).filter((a): a is Account => a !== undefined)
    return {
      accountIds: known.accountIds,
      chosen,
      period,
      nowMs: env.nowMs,
      tzOffsetMin: env.tzOffsetMin,
      currency: known.currency ?? 'USD',
      mixed: known.mixedCurrency,
      accountMissing: known.accountMissing,
      periodOverridden,
      ownAccountName: known.source === 'widget' ? (known.accounts[0]?.name ?? null) : null,
      source: known.source,
    }
  }
  let chosen: Account[]
  let accountIds: number[]
  let ownAccountName: string | null = null
  let accountMissing = false
  if (own.accountId !== null) {
    chosen = env.allAccounts.filter((a) => a.id === own.accountId)
    accountIds = [own.accountId]
    accountMissing = chosen.length === 0
    ownAccountName = chosen[0]?.name ?? null
  } else if (env.selectedId !== null) {
    chosen = env.allAccounts.filter((a) => a.id === env.selectedId)
    accountIds = [env.selectedId]
  } else {
    chosen = env.accounts
    accountIds = []
  }
  return {
    accountIds,
    chosen,
    period,
    nowMs: env.nowMs,
    tzOffsetMin: env.tzOffsetMin,
    currency: chosen[0]?.currency ?? 'USD',
    mixed: chosen.some((a) => a.currency !== chosen[0].currency),
    accountMissing,
    periodOverridden,
    ownAccountName,
    source: own.accountId !== null ? 'widget' : 'topBar',
  }
}

/** Requête des rapports de statistiques (bornes `[from, to)` de la période). */
export const statsQueryOf = (scope: Scope): StatsQuery => ({
  accountIds: scope.accountIds,
  ...periodRange(scope.period, scope.nowMs, scope.tzOffsetMin),
})
