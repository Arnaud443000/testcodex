import { useState } from 'react'
import { useT } from '../../i18n'
import { usePause } from '../../lib/pause'
import { endClock } from '../../lib/pauseView'
import { Notice } from '../ui'
import { PausePicker } from './PausePicker'

/**
 * Dans le formulaire de trade (nouveau trade seulement). Pendant une pause : un encadré bien visible mais jamais
 * bloquant, sans fenêtre modale, qui ne gêne pas « Enregistrer » ; « Je continue quand même » le masque pour
 * cette saisie, « Terminer la pause » la clôt. Sans pause : une proposition discrète d'en faire une.
 * Aucun `<form>` ici (le formulaire de trade englobe ce panneau) : tous les boutons sont de type « button ».
 */
export function PauseFormPanel() {
  const t = useT().pause
  const { current, end } = usePause()
  const [dismissed, setDismissed] = useState(false)
  const [offering, setOffering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (current) {
    if (dismissed) return null
    const { time, tomorrow } = endClock(current.pause.plannedEndAt, Date.now())
    return (
      <Notice
        level="warn"
        actions={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDismissed(true)}>{t.form.continue}</button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => end().catch((e) => setError(t.picker.endError(String(e instanceof Error ? e.message : e))))}
            >
              {t.form.end}
            </button>
          </>
        }
      >
        <strong className="block">{t.form.title(tomorrow ? t.topbar.tomorrow(time) : time)}</strong>
        {t.form.question}
        <span className="mt-1 block text-[13px] text-tx2">{t.form.reassure}</span>
        {error && <span className="mt-1 block">{error}</span>}
      </Notice>
    )
  }

  return (
    <div className="glass-card p-4">
      {offering ? (
        <PausePicker focusOnOpen onDone={() => setOffering(false)} onCancel={() => setOffering(false)} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] text-tx2">{t.form.offerTitle}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOffering(true)}>{t.form.offerButton}</button>
        </div>
      )}
    </div>
  )
}
