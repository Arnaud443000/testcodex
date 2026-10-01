import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { usePause } from '../../lib/pause'
import { LENGTH_CHOICES, buildNewPause, initialLength, type LengthChoice } from '../../lib/pauseView'
import { localTzOffsetMin } from '../../lib/period'
import { PAUSE_NOTE_MAX_CHARS, PAUSE_REASONS, type PauseReason } from '../../types/pause'
import { ChipButton } from '../ui'

/**
 * Choix d'une pause : durée rapide ou libre, motif et mot facultatifs. Un panneau dans le flux (jamais une
 * fenêtre modale), utilisable dans le formulaire de trade : aucun `<form>`, aucun bouton de type « submit »,
 * et Entrée dans un champ démarre la pause au lieu d'enregistrer le trade.
 */
export function PausePicker({
  reason: initialReason = null,
  onDone,
  onCancel,
  focusOnOpen = false,
}: {
  reason?: PauseReason | null
  onDone: () => void
  onCancel: () => void
  focusOnOpen?: boolean
}) {
  const t = useT().pause.picker
  const { settings, start } = usePause()
  const first = initialLength(settings?.defaultMinutes ?? 30)
  const [choice, setChoice] = useState<LengthChoice>(first.choice)
  const [customText, setCustomText] = useState(first.customText)
  const [reason, setReason] = useState<PauseReason | null>(initialReason)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (focusOnOpen) root.current?.focus()
  }, [focusOnOpen])

  async function submit() {
    if (busy) return
    const built = buildNewPause({ choice, customText, reason, note, tzOffsetMin: localTzOffsetMin() })
    if (!built.ok) {
      setError(t.customError)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await start(built.pause)
      onDone()
    } catch (e) {
      setError(t.startError(String(e instanceof Error ? e.message : e)))
      setBusy(false)
    }
  }

  const enter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void submit()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      onCancel()
    }
  }

  return (
    <div ref={root} tabIndex={-1} role="group" aria-label={t.title} className="flex flex-col gap-4 outline-none" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <div>
        <h3 className="text-[15px] font-semibold">{t.title}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-tx2">{t.intro}</p>
      </div>

      <div>
        <div className="caption mb-2" id="pause-length-label">{t.lengthLabel}</div>
        <div role="group" aria-labelledby="pause-length-label" className="flex flex-wrap gap-2">
          {LENGTH_CHOICES.map((c) => (
            <ChipButton key={c} on={choice === c} onClick={() => { setChoice(c); setError(null) }}>
              {t.lengths[c]}
            </ChipButton>
          ))}
        </div>
        {choice === 'custom' && (
          <label className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="caption">{t.customLabel}</span>
            <input
              className="input !w-24"
              inputMode="numeric"
              autoComplete="off"
              value={customText}
              aria-invalid={error !== null}
              onChange={(e) => { setCustomText(e.target.value); setError(null) }}
              onKeyDown={enter}
            />
            <span className="text-xs text-tx3">{t.customHint}</span>
          </label>
        )}
      </div>

      <div>
        <div className="caption mb-2" id="pause-reason-label">{t.reasonLabel}</div>
        <div role="group" aria-labelledby="pause-reason-label" className="flex flex-wrap gap-2">
          {PAUSE_REASONS.map((r) => (
            <ChipButton key={r} on={reason === r} onClick={() => setReason(reason === r ? null : r)}>
              {t.reasons[r]}
            </ChipButton>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="caption">{t.noteLabel}</span>
        <input
          className="input"
          autoComplete="off"
          maxLength={PAUSE_NOTE_MAX_CHARS}
          placeholder={t.notePlaceholder}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={enter}
        />
        <span className="self-end text-xs tabular-nums text-tx3">{t.noteCount([...note].length, PAUSE_NOTE_MAX_CHARS)}</span>
      </label>

      {error && <div className="nt nt-bad" role="alert">{error}</div>}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void submit()}>
          {busy ? t.starting : t.start}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>{t.cancel}</button>
      </div>
    </div>
  )
}
