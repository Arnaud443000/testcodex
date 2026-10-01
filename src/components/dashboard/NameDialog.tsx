import { useState, type FormEvent } from 'react'
import { Modal } from './Modal'
import { useT } from '../../i18n'
import { Field } from '../ui'
import { ScopeFields, scopeIncomplete } from './ScopeFields'
import type { Account } from '../../types/account'
import { FOLLOW_SCOPE, type DashboardScope } from '../../types/dashboardLayout'

/** Demande le nom d'un dashboard. Le message d'erreur (nom déjà pris, vide…) vient de pulse-core. */
export function NameDialog({
  title,
  initial,
  submitLabel,
  onSubmit,
  onClose,
  scopeAccounts,
}: {
  title: string
  initial: string
  submitLabel: string
  /** `scope` n'est renseigné que si `scopeAccounts` l'est (création ou copie : la portée se choisit là). */
  onSubmit: (name: string, scope: DashboardScope | null) => Promise<void>
  onClose: () => void
  /** Comptes proposés pour la portée du nouveau dashboard ; absent = pas de choix de portée. */
  scopeAccounts?: Account[]
}) {
  const t = useT()
  const [name, setName] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [scope, setScope] = useState<DashboardScope>(FOLLOW_SCOPE)
  const withScope = scopeAccounts !== undefined

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (withScope && scopeIncomplete(scope)) return setError(t.dashboardBuilder.scope.accountRequired)
    setBusy(true)
    setError(null)
    try {
      await onSubmit(name, withScope ? scope : null)
    } catch (err) {
      setError(t.dashboardBuilder.toolbar.saveError(err instanceof Error ? err.message : String(err)))
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t.dashboardBuilder.toolbar.nameLabel} htmlFor="dashboard-name">
          <input
            id="dashboard-name"
            className="input"
            value={name}
            maxLength={60}
            placeholder={t.dashboardBuilder.toolbar.namePlaceholder}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
        </Field>
        {withScope && <ScopeFields scope={scope} accounts={scopeAccounts} onChange={setScope} />}
        {error && <div className="nt nt-bad" role="alert">{error}</div>}
        <div className="flex justify-end gap-3">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t.common.cancel}</button>
          <button type="submit" className="btn btn-primary" disabled={busy || name.trim() === ''}>{submitLabel}</button>
        </div>
      </form>
    </Modal>
  )
}
