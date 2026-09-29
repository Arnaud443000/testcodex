import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import { formatBytes } from '../lib/aiView'
import type { AiSendPreview } from '../types/ai'
import { Modal } from './dashboard/Modal'
import { Notice } from './ui'

/**
 * Confirmation avant CHAQUE envoi d'image (lot 20). Affiche exactement ce que pulse-core a calculé
 * comme contenu envoyé. À la première utilisation, une case à cocher est exigée en plus.
 * Il n'existe pas d'option « Ne plus demander ».
 */
export function AiSendDialog({ preview, onSend, onCancel }: { preview: AiSendPreview; onSend: () => void; onCancel: () => void }) {
  const t = useT()
  const d = t.ai.dialog
  const [understood, setUnderstood] = useState(false)
  const image = preview.context.image
  const blocked = !preview.enabled
    ? d.disabled
    : !image
      ? d.noScreenshot
      : image.missing
        ? d.missingFile
        : image.tooLarge
          ? d.tooLarge(formatBytes(image.bytes))
          : null
  const canSend = !blocked && (!preview.firstUse || understood)

  // Rendue dans <body> : une carte en verre (backdrop-filter) enfermerait une boîte `fixed` à l'intérieur.
  return createPortal(
    <Modal title={d.title} onClose={onCancel} wide>
      <div className="flex flex-col gap-4 text-sm">
        {preview.firstUse && !blocked && (
          <section className="flex flex-col gap-2 rounded-inner border border-violet/45 bg-violet/[0.08] p-4" aria-labelledby="ai-first-use">
            <h3 id="ai-first-use" className="caption">{d.firstUseTitle}</h3>
            {d.firstUse.map((p) => (
              <p key={p} className="leading-relaxed text-tx2">{p}</p>
            ))}
            <label className="mt-1 flex cursor-pointer items-start gap-2.5 font-medium">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-violet" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              {d.firstUseCheck}
            </label>
          </section>
        )}

        {blocked ? (
          <Notice level="bad">{blocked}</Notice>
        ) : (
          <section aria-labelledby="ai-sent-title" className="flex flex-col gap-2">
            <h3 id="ai-sent-title" className="caption">{d.sentTitle}</h3>
            <ul className="flex flex-col">
              <li className="hairline-row">
                <span className="text-tx2">▣ {d.image(image!.mediaType.replace('image/', '').toUpperCase(), formatBytes(image!.bytes))}</span>
              </li>
              {preview.context.fields.map((f) =>
                f.key === 'thesis' ? (
                  <li key={f.key} className="flex flex-col gap-1.5 border-b py-2.5" style={{ borderColor: 'var(--hairline)' }}>
                    <span className="text-tx2">{d.fields.thesis}</span>
                    <blockquote className="max-h-32 overflow-auto whitespace-pre-wrap rounded-sm bg-white/5 px-3 py-2 text-[13px] leading-relaxed">
                      {f.value}
                    </blockquote>
                  </li>
                ) : (
                  <li key={f.key} className="hairline-row">
                    <span className="text-tx2">{d.fields[f.key]}</span>
                    <span className="font-semibold tabular-nums">{f.key === 'direction' ? d.directions[f.value] ?? f.value : f.value}</span>
                  </li>
                ),
              )}
            </ul>
            <p className="text-tx2">{d.to(preview.providerHost, preview.model)}</p>
            <p className="text-tx3">{d.never}</p>
          </section>
        )}

        {/* Toujours visible, même quand le contenu défile : le rappel et les deux boutons. */}
        <div className="sticky -bottom-6 -mx-6 -mb-6 flex flex-col gap-3 border-t bg-bg px-6 pb-6 pt-4" style={{ borderColor: 'var(--hairline)' }}>
          <p className="text-[13px] font-medium text-tx">{d.notAutomatic}</p>
          <div className="flex justify-end gap-2.5">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>{d.cancel}</button>
            <button type="button" className="btn btn-primary" onClick={onSend} disabled={!canSend}>{d.send}</button>
          </div>
        </div>
      </div>
    </Modal>,
    document.body,
  )
}
