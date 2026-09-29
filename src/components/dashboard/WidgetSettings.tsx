import { Modal } from './Modal'
import { useT } from '../../i18n'
import { PERIOD_KEYS } from '../../lib/period'
import type { Account } from '../../types/account'
import type { ResolvedScope, WidgetDefinition, WidgetInstance } from '../../types/dashboardLayout'
import type { PeriodKey } from '../../types/stats'
import { Field } from '../ui'
import { Icon } from '../Icon'

/** Liste déroulante avec le chevron des autres listes de l'application. */
function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative">
      <select className="input" {...props}>{children}</select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tx3"><Icon name="chevron" size={16} /></span>
    </span>
  )
}

/** Réglages propres à un widget (3.8.8) : période, compte, mode d'affichage — seulement ceux qui ont un sens pour lui. */
export function WidgetSettings({
  instance,
  def,
  accounts,
  dashboardScope,
  onChange,
  onClose,
}: {
  instance: WidgetInstance
  def: WidgetDefinition
  accounts: Account[]
  /** Portée du dashboard (3.8.9) : ce que le widget lit tant qu'on ne lui fixe pas de compte. */
  dashboardScope?: ResolvedScope | null
  onChange: (patch: Partial<Pick<WidgetInstance, 'period' | 'accountId' | 'mode'>>) => void
  onClose: () => void
}) {
  const t = useT().dashboardBuilder
  const name = t.widgets[def.kind]?.title ?? def.kind
  const hasAny = def.period || def.account || def.modes.length > 0
  const inherit =
    dashboardScope?.effective === 'account'
      ? t.scope.inheritAccount(dashboardScope.accounts[0]?.name ?? '')
      : dashboardScope?.effective === 'all'
        ? t.scope.inheritAll
        : t.settings.accountGlobal
  const dashboardHasScope = dashboardScope !== null && dashboardScope !== undefined && dashboardScope.effective !== 'follow'
  return (
    <Modal title={t.settings.title(name)} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {!hasAny && <p className="text-sm text-tx2">{t.settings.none}</p>}
        {def.period && (
          <Field label={t.settings.period} htmlFor="ws-period">
            <Select
              id="ws-period"
              value={instance.period ?? ''}
              onChange={(e) => onChange({ period: (e.target.value || null) as PeriodKey | null })}
            >
              <option value="" className="bg-bg">{t.settings.periodGlobal}</option>
              {PERIOD_KEYS.map((p) => (
                <option key={p} value={p} className="bg-bg">{t.periods[p]}</option>
              ))}
            </Select>
          </Field>
        )}
        {def.account && (
          <Field label={t.settings.account} htmlFor="ws-account">
            <Select
              id="ws-account"
              value={instance.accountId ?? ''}
              onChange={(e) => onChange({ accountId: e.target.value === '' ? null : Number(e.target.value) })}
            >
              <option value="" className="bg-bg">{inherit}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id} className="bg-bg">{a.archived ? `${a.name} (archivé)` : a.name}</option>
              ))}
            </Select>
          </Field>
        )}
        {def.modes.length > 0 && (
          <Field label={t.settings.mode} htmlFor="ws-mode">
            <Select id="ws-mode" value={instance.mode ?? def.modes[0]} onChange={(e) => onChange({ mode: e.target.value })}>
              {def.modes.map((m) => (
                <option key={m} value={m} className="bg-bg">{t.modes[def.kind]?.[m] ?? m}</option>
              ))}
            </Select>
          </Field>
        )}
        {hasAny && <p className="text-xs text-tx3">{t.settings.hint}</p>}
        {def.account && dashboardHasScope && <p className="text-xs text-tx3">{t.scope.inWidgetSettings}</p>}
        <button type="button" className="btn btn-primary self-end" data-close onClick={onClose}>{t.settings.close}</button>
      </div>
    </Modal>
  )
}
