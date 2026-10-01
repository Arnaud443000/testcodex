import { useState, type FormEvent } from 'react'
import { Modal } from './Modal'
import { ScopeFields, scopeIncomplete } from './ScopeFields'
import { useT } from '../../i18n'
import type { Account } from '../../types/account'
import type { DashboardScope } from '../../types/dashboardLayout'

/** Change la portée d'un dashboard de l'utilisateur. Les refus (compte inconnu…) viennent de pulse-core. */
export function ScopeDialog({
  initial,
  accounts,
  onSubmit,
  onClose,
}: {
  initial: DashboardScope
  accounts: Account[]
  onSubmit: (scope: DashboardScope) => Promise<void>
  onClose: () => void
}) {
  const t = useT()
  const s = t.dashboardBuilder.scope
  // Un compte lié supprimé (accountId vide) : on repart de « suivre la barre du haut ».
  const [scope, setScope] = useState<DashboardScope>(scopeIncomplete(initial) ? { kind: 'follow', accountId: null } : initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const incomplete = scopeIncomplete(scope)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (incomplete) return setError(s.accountRequired)
    setBusy(true)
    setError(null)
    try {
      await onSubmit(scope)
    } catch (err) {
      setError(t.dashboardBuilder.toolbar.saveError(err instanceof Error ? err.message : String(err)))
      setBusy(false)
    }
  }

  return (
    <Modal title={s.title} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-tx2">{s.intro}</p>
        <ScopeFields scope={scope} accounts={accounts} onChange={setScope} />
        {error && <div className="nt nt-bad" role="alert">{error}</div>}
        <div className="flex justify-end gap-3">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t.common.cancel}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{s.apply}</button>
        </div>
      </form>
    </Modal>
  )
}
