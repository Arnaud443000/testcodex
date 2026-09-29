import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../i18n'
import { Modal } from '../dashboard/Modal'

/**
 * Explication de première utilisation du coach (lot 21), avec case à cocher : consentement propre au
 * coach, distinct de celui de l'analyse de screenshot. Rendue dans <body> (une carte en verre à
 * `backdrop-filter` enfermerait une boîte `fixed`).
 */
export function CoachConsentDialog({ host, model, onAccept, onCancel }: { host: string; model: string; onAccept: () => void; onCancel: () => void }) {
  const t = useT()
  const c = t.coach.consent
  const [understood, setUnderstood] = useState(false)
  return createPortal(
    <Modal title={c.title} onClose={onCancel} wide>
      <div className="flex flex-col gap-4 text-sm">
        <section className="flex flex-col gap-2 rounded-inner border border-violet/45 bg-violet/[0.08] p-4">
          {c.paragraphs.map((p) => (
            <p key={p} className="leading-relaxed text-tx2">{p}</p>
          ))}
          <p className="leading-relaxed text-tx2">{t.coach.reminder.to(host, model)}</p>
          <label className="mt-1 flex cursor-pointer items-start gap-2.5 font-medium">
            <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-violet" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            {c.check}
          </label>
        </section>
        <div className="sticky -bottom-6 -mx-6 -mb-6 flex flex-col gap-3 border-t bg-bg px-6 pb-6 pt-4" style={{ borderColor: 'var(--hairline)' }}>
          <p className="text-[13px] font-medium text-tx">{t.coach.reminder.notAutomatic}</p>
          <div className="flex justify-end gap-2.5">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>{c.cancel}</button>
            <button type="button" className="btn btn-primary" onClick={onAccept} disabled={!understood}>{c.send}</button>
          </div>
        </div>
      </div>
    </Modal>,
    document.body,
  )
}
