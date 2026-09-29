import { useState, type FormEvent } from 'react'
import { Modal } from './Modal'
import { useT } from '../../i18n'
import { Field } from '../ui'

/** Demande le nom d'un dashboard. Le message d'erreur (nom déjà pris, vide…) vient de pulse-core. */
export function NameDialog({
  title,
  initial,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string
  initial: string
  submitLabel: string
  onSubmit: (name: string) => Promise<void>
  onClose: () => void
}) {
  const t = useT()
  const [name, setName] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(name)
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
        {error && <div className="nt nt-bad" role="alert">{error}</div>}
        <div className="flex justify-end gap-3">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t.common.cancel}</button>
          <button type="submit" className="btn btn-primary" disabled={busy || name.trim() === ''}>{submitLabel}</button>
        </div>
      </form>
    </Modal>
  )
}
