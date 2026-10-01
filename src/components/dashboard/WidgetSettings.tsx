import { Modal } from './Modal'
import { useT } from '../../i18n'
import { PERIOD_KEYS } from '../../lib/period'
import type { Account } from '../../types/account'
import type { ResolvedScope, WidgetDefinition, WidgetInstance } from '../../types/dashboardLayout'
import type { PeriodKey } from '../../types/stats'
import { Field } from '../ui'
import { Select } from '../ui/Select'

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
              onChange={(v) => onChange({ period: (v || null) as PeriodKey | null })}
              options={[{ value: '', label: t.settings.periodGlobal }, ...PERIOD_KEYS.map((p) => ({ value: p, label: t.periods[p] }))]}
            />
          </Field>
        )}
        {def.account && (
          <Field label={t.settings.account} htmlFor="ws-account">
            <Select
              id="ws-account"
              value={instance.accountId === null || instance.accountId === undefined ? '' : String(instance.accountId)}
              onChange={(v) => onChange({ accountId: v === '' ? null : Number(v) })}
              options={[{ value: '', label: inherit }, ...accounts.map((a) => ({ value: String(a.id), label: a.archived ? `${a.name} (archivé)` : a.name }))]}
            />
          </Field>
        )}
        {def.modes.length > 0 && (
          <Field label={t.settings.mode} htmlFor="ws-mode">
            <Select
              id="ws-mode"
              value={instance.mode ?? def.modes[0]}
              onChange={(v) => onChange({ mode: v })}
              options={def.modes.map((m) => ({ value: m, label: t.modes[def.kind]?.[m] ?? m }))}
            />
          </Field>
        )}
        {hasAny && <p className="text-xs text-tx3">{t.settings.hint}</p>}
        {def.account && dashboardHasScope && <p className="text-xs text-tx3">{t.scope.inWidgetSettings}</p>}
        <button type="button" className="btn btn-primary self-end" data-close onClick={onClose}>{t.settings.close}</button>
      </div>
    </Modal>
  )
}
