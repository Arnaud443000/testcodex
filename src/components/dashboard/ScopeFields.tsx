import { useT } from '../../i18n'
import type { Account } from '../../types/account'
import type { DashboardScope, ScopeKind } from '../../types/dashboardLayout'
import { Icon } from '../Icon'

/** Erreur de saisie de la portée (aucun calcul : la validation qui fait foi est celle de pulse-core). */
export const scopeIncomplete = (scope: DashboardScope): boolean => scope.kind === 'account' && scope.accountId === null

/** Choix de la portée d'un dashboard (3.8.9) : barre du haut, un compte, ou tous les comptes. */
export function ScopeFields({
  scope,
  accounts,
  onChange,
}: {
  scope: DashboardScope
  /** Comptes proposés : les actifs, plus celui déjà lié s'il est archivé. */
  accounts: Account[]
  onChange: (scope: DashboardScope) => void
}) {
  const t = useT().dashboardBuilder.scope
  const choices: { kind: ScopeKind; label: string; hint: string }[] = [
    { kind: 'follow', label: t.follow, hint: t.followHint },
    { kind: 'account', label: t.account, hint: t.accountHint },
    { kind: 'all', label: t.all, hint: t.allHint },
  ]
  const pick = (kind: ScopeKind) =>
    onChange({ kind, accountId: kind === 'account' ? (scope.accountId ?? (accounts.length === 1 ? accounts[0].id : null)) : null })
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-tx2">{t.label}</legend>
      {choices.map((c) => {
        const on = scope.kind === c.kind
        return (
          <label
            key={c.kind}
            className={`flex cursor-pointer items-start gap-3 rounded-[12px] border px-3 py-2.5 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-violet ${
              on ? 'border-violet bg-white/[0.06]' : 'border-white/10 hover:bg-white/[0.04]'
            }`}
          >
            <input type="radio" name="dashboard-scope" className="mt-1 accent-violet" checked={on} onChange={() => pick(c.kind)} />
            <span className="flex flex-col">
              <span className="text-sm font-medium">{c.label}</span>
              <span className="text-xs leading-relaxed text-tx3">{c.hint}</span>
            </span>
          </label>
        )
      })}
      {scope.kind === 'account' && (
        <label className="mt-1 flex flex-col gap-1.5 text-sm text-tx2" htmlFor="dashboard-scope-account">
          {t.accountField}
          <span className="relative">
            <select
              id="dashboard-scope-account"
              className="input"
              value={scope.accountId ?? ''}
              onChange={(e) => onChange({ kind: 'account', accountId: e.target.value === '' ? null : Number(e.target.value) })}
            >
              <option value="" className="bg-bg">{t.accountChoose}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id} className="bg-bg">{a.archived ? t.accountArchivedOption(a.name) : a.name}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tx3"><Icon name="chevron" size={16} /></span>
          </span>
        </label>
      )}
      <p className="mt-1 text-xs leading-relaxed text-tx3">{t.priority}</p>
    </fieldset>
  )
}
