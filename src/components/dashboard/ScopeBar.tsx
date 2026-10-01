import { useT } from '../../i18n'
import { Tooltip } from '../ui/Tooltip'
import type { Account } from '../../types/account'
import type { ResolvedDashboard } from '../../types/dashboardLayout'

/**
 * Indique clairement ce que lit le dashboard affiché (3.8.9). Tout vient de `resolve_dashboard_scope` : ce
 * composant ne fait que formuler. `onChange` absent = dashboard livré (portée fixe) ou mode modification.
 */
export function ScopeBar({
  resolved,
  selectedAccount,
  onChange,
  isPreset,
}: {
  resolved: ResolvedDashboard
  /** Compte choisi dans la barre du haut (pour l'indiquer quand le dashboard le suit). */
  selectedAccount: Account | null
  onChange?: () => void
  isPreset: boolean
}) {
  const t = useT().dashboardBuilder.scope
  const { scope } = resolved
  const own = resolved.widgets.filter((w) => w.source === 'widget').length
  const label =
    scope.effective === 'account'
      ? t.badge.account(scope.accounts[0]?.name ?? '')
      : scope.effective === 'all'
        ? t.badge.all(scope.accounts.length)
        : t.badge.follow(selectedAccount ? selectedAccount.name : t.badge.allAccounts)
  const archived = scope.effective === 'account' && scope.accounts[0]?.archived
  return (
    <div className="flex flex-col gap-2" data-testid="dashboard-scope">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <Tooltip content={t.title}>
          <span className="badge">
            <span className="text-tx3">{t.label} :</span> {label}
            {archived && <span className="ml-1 text-tx3">({t.archivedTag})</span>}
          </span>
        </Tooltip>
        {scope.effective !== 'follow' && <span className="text-xs text-tx3">{t.ignoresTopBar}</span>}
        {own > 0 && <span className="text-xs text-tx3">{t.widgetOwnAccount(own)}</span>}
        {onChange && !isPreset && (
          <button type="button" className="btn-link !text-xs" onClick={onChange}>
            {t.change}
          </button>
        )}
      </div>
      {scope.notices.map((n) => (
        <div key={n} className="nt nt-warn" role="status">{t.notice[n]}</div>
      ))}
    </div>
  )
}
