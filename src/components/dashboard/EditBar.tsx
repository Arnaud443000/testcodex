import { useState } from 'react'
import { Tooltip } from '../ui/Tooltip'
import { Icon } from '../Icon'
import { useT } from '../../i18n'

/** Barre du mode modification : ajouter, réinitialiser, annuler, enregistrer. Les actions destructrices demandent confirmation. */
export function EditBar({
  name,
  builtin,
  dirty,
  libraryOpen,
  error,
  onToggleLibrary,
  onReset,
  onCancel,
  onSave,
}: {
  name: string
  builtin: boolean
  dirty: boolean
  libraryOpen: boolean
  error: string | null
  onToggleLibrary: () => void
  onReset: () => void
  onCancel: () => void
  onSave: () => void
}) {
  const t = useT().dashboardBuilder
  const [confirm, setConfirm] = useState<'reset' | 'cancel' | null>(null)
  const ask = (kind: 'reset' | 'cancel', now: () => void) => (dirty ? setConfirm(kind) : now())
  return (
    <section className="glass-card flex flex-col gap-3 px-5 py-4" aria-label={t.toolbar.editing}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto min-w-0">
          <p className="text-[15px] font-semibold">
            {t.toolbar.editing} <span className="text-tx2">— {name}</span>
          </p>
          {builtin && <p className="mt-0.5 text-xs text-tx3">{t.toolbar.builtinHint}</p>}
        </div>
        {dirty && <span className="badge badge-warn">{t.toolbar.unsaved}</span>}
        {confirm ? (
          <span className="flex items-center gap-2 text-sm" role="alertdialog" aria-label={confirm === 'reset' ? t.toolbar.resetConfirm : t.toolbar.cancelConfirm}>
            <span className="text-tx2">{confirm === 'reset' ? t.toolbar.resetConfirm : t.toolbar.cancelConfirm}</span>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => {
                const which = confirm
                setConfirm(null)
                if (which === 'reset') onReset()
                else onCancel()
              }}
            >
              {confirm === 'reset' ? t.toolbar.resetYes : t.toolbar.cancelYes}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirm(null)}>{t.toolbar.keepEditing}</button>
          </span>
        ) : (
          <>
            <button type="button" className={`btn btn-secondary btn-sm ${libraryOpen ? 'chip-on' : ''}`} aria-pressed={libraryOpen} onClick={onToggleLibrary}>
              <Icon name="library" size={16} />
              {t.toolbar.addWidget}
            </button>
            <Tooltip content={t.toolbar.resetPresetHint}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => ask('reset', onReset)}>
                <Icon name="reset" size={16} />
                {t.toolbar.reset}
              </button>
            </Tooltip>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => ask('cancel', onCancel)}>{t.toolbar.cancel}</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={onSave}>
              <Icon name="check" size={16} />
              {builtin ? t.toolbar.saveAs : t.toolbar.save}
            </button>
          </>
        )}
      </div>
      <p id="edit-help" className="text-xs leading-relaxed text-tx3">{t.edit.help}</p>
      {error && <div className="nt nt-bad" role="alert">{error}</div>}
    </section>
  )
}
