import { Checkbox } from './ui/Checkbox'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { formatBytes } from '../lib/aiView'
import {
  buildCardModel,
  cardFileName,
  DEFAULT_CARD_OPTIONS,
  MAX_CARD_BYTES,
  readPngInfo,
  type CardLabels,
} from '../lib/tradeCard'
import { blobToBase64, canvasToPngBlob, ensureCardFonts, loadCardImage, renderCard } from '../lib/tradeCardRender'
import type { TradeView } from '../types/trade'
import type { CardFormat, CardOptions, TradeCardFigures } from '../types/tradeCard'
import { Modal } from './dashboard/Modal'
import { Notice } from './ui'

type Message = { level: 'ok' | 'warn' | 'bad'; text: string }

/**
 * Carte de trade (lot 24, cahier 3.7.7) : options à cocher, aperçu en direct, enregistrement en PNG
 * et copie dans le presse-papiers. Tout est local : aucun accès réseau. L'aperçu EST l'image exportée
 * (le même canvas), donc ce qu'on voit est exactement ce qui est enregistré.
 */
export function TradeCardDialog({ trade, setupName, screenshotUrl, onClose }: { trade: TradeView; setupName: string | null; screenshotUrl: string | null; onClose: () => void }) {
  const t = useT()
  const d = t.tradeCard
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [options, setOptions] = useState<CardOptions>(DEFAULT_CARD_OPTIONS)
  const [figures, setFigures] = useState<TradeCardFigures | null>(null)
  const [figuresError, setFiguresError] = useState<string | null>(null)
  const [drawError, setDrawError] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [busy, setBusy] = useState<'save' | 'copy' | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let live = true
    api.getTradeCardFigures(trade.id).then((f) => live && setFigures(f)).catch((e) => live && setFiguresError(String(e).replace(/^Error: /, '')))
    return () => {
      live = false
    }
  }, [trade.id])

  const labels: CardLabels = useMemo(() => ({ directions: d.card.directions, outcomes: d.card.outcomes }), [d])
  const model = useMemo(() => (figures ? buildCardModel({ trade, setupName, figures }, options, labels) : null), [trade, setupName, figures, options, labels])

  // Redessin à chaque changement : la police d'abord, puis la capture, puis le canvas.
  useEffect(() => {
    if (!model || !canvasRef.current) return
    let live = true
    const canvas = canvasRef.current
    void (async () => {
      const found: string[] = []
      try {
        await ensureCardFonts()
      } catch {
        if (live) setDrawError(d.fontError)
        return
      }
      let shot: Awaited<ReturnType<typeof loadCardImage>> | null = null
      if (model.screenshot && screenshotUrl) {
        try {
          shot = await loadCardImage(screenshotUrl)
        } catch {
          found.push(d.screenshotError)
        }
      }
      if (!live) return
      try {
        const { plan } = renderCard(canvas, model, { setup: d.options.setup, thesis: d.card.thesis, postMortem: d.card.postMortem, pnlCaption: d.card.pnlCaption }, shot)
        if (plan.screenshotNoRoom) found.push(d.screenshotNoRoom)
        if (plan.textsDropped) found.push(d.textDropped)
        if (plan.truncated) found.push(d.textTruncated)
        setDrawError(null)
        setNotes(found)
        setReady(true)
      } catch (e) {
        setDrawError(d.previewError(String(e)))
      }
    })()
    return () => {
      live = false
    }
  }, [model, screenshotUrl, d])

  const set = <K extends keyof CardOptions>(key: K, value: CardOptions[K]) => {
    setMessage(null)
    setOptions((o) => ({ ...o, [key]: value }))
  }

  const pngBlob = async () => {
    const blob = await canvasToPngBlob(canvasRef.current!)
    if (blob.size > MAX_CARD_BYTES) throw new Error(d.tooLarge)
    return blob
  }

  const save = async () => {
    setBusy('save')
    setMessage(null)
    try {
      const blob = await pngBlob()
      const path = await api.pickPngPath(d.saveTitle, cardFileName(trade.symbol, trade.exitTime ?? trade.entryTime))
      if (!path) return
      const info = readPngInfo(new Uint8Array(await blob.arrayBuffer()))
      if (!info) throw new Error('png')
      await api.saveTradeCardImage(path, await blobToBase64(blob))
      setMessage({ level: 'ok', text: `${d.saved(path)} (${info.width} × ${info.height}, ${formatBytes(info.bytes)})` })
    } catch (e) {
      setMessage({ level: 'bad', text: d.saveError(String(e).replace(/^Error: /, '')) })
    } finally {
      setBusy(null)
    }
  }

  const copy = async () => {
    setMessage(null)
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      setMessage({ level: 'warn', text: d.copyUnavailable })
      return
    }
    setBusy('copy')
    try {
      const blob = await pngBlob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setMessage({ level: 'ok', text: d.copied })
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      setMessage(denied ? { level: 'warn', text: d.copyUnavailable } : { level: 'bad', text: d.copyError(String(e).replace(/^Error: /, '')) })
    } finally {
      setBusy(null)
    }
  }

  const f = figures
  const hasSetup = !!setupName?.trim()
  const hasShot = !!trade.screenshotPath
  const hasThesis = !!trade.thesis.trim()
  const hasPost = !!trade.postMortem.trim()

  const check = ({ id, hint, disabled = false }: { id: keyof Omit<CardOptions, 'format'>; hint?: string; disabled?: boolean }) => (
    <li key={id} className="flex flex-col gap-0.5">
      <Checkbox checked={options[id] && !disabled} disabled={disabled} onChange={(v) => set(id, v)} label={<span className="font-medium">{d.options[id]}</span>} />
      {hint && <p className="pl-[26px] text-xs text-tx3">{hint}</p>}
    </li>
  )

  return createPortal(
    <Modal title={d.title} onClose={onClose} maxWidth="max-w-[1100px]">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-tx2">{d.intro}</p>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <div className="nt nt-ok text-[13px]" role="note">{d.privacy}</div>

            <fieldset className="flex flex-col gap-2">
              <legend className="caption mb-1">{d.formatTitle}</legend>
              <div className="flex gap-2" role="radiogroup" aria-label={d.formatTitle}>
                {(['portrait', 'square'] as CardFormat[]).map((k) => (
                  <label key={k} className={`chip cursor-pointer text-[13px] ${options.format === k ? 'chip-on' : ''}`}>
                    <input type="radio" name="card-format" className="sr-only" checked={options.format === k} onChange={() => set('format', k)} />
                    {d.formats[k]}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="caption mb-1">{d.elementsTitle}</legend>
              <ul className="flex flex-col gap-2.5">
                {check({ id: 'symbol' })}
                {check({ id: 'direction' })}
                {check({ id: 'resultR', hint: f && !f.closed ? d.hints.open : f && f.rMultiple === null ? d.hints.noSl : undefined })}
                {check({ id: 'resultPct', hint: d.hints.resultPct })}
                {check({ id: 'setup', disabled: !hasSetup, hint: !hasSetup ? d.hints.noSetup : undefined })}
                {check({ id: 'date' })}
                {check({ id: 'screenshot', disabled: !hasShot, hint: hasShot ? d.hints.screenshotWarn : d.hints.noScreenshot })}
                {check({ id: 'pnlMoney', disabled: !!f && !f.closed })}
                {options.pnlMoney && f?.closed && <li key="pnl-warn" className="nt nt-warn text-[13px]" role="alert">{d.pnlWarning}</li>}
                {check({ id: 'thesis', disabled: !hasThesis, hint: !hasThesis ? d.hints.noThesis : undefined })}
                {check({ id: 'postMortem', disabled: !hasPost, hint: !hasPost ? d.hints.noPostMortem : undefined })}
                {((options.thesis && hasThesis) || (options.postMortem && hasPost)) && <li key="text-warn" className="nt nt-warn text-[13px]" role="alert">{d.textWarning}</li>}
              </ul>
            </fieldset>

          </div>

          <section className="flex flex-col gap-3" aria-label={d.previewTitle}>
            <h3 className="caption">{d.previewTitle}</h3>
            {figuresError ? (
              <Notice level="bad">{figuresError}</Notice>
            ) : drawError ? (
              <Notice level="bad">{drawError}</Notice>
            ) : (
              <div className="flex justify-center rounded-inner border p-3" style={{ borderColor: 'var(--hairline)', background: 'rgba(255,255,255,.03)' }}>
                {!ready && <p className="py-20 text-sm text-tx2">{d.previewLoading}</p>}
                <canvas
                  ref={canvasRef}
                  role="img"
                  aria-label={d.previewLabel}
                  data-testid="trade-card-canvas"
                  className={`h-auto max-h-[58vh] w-auto max-w-full rounded-sm ${ready ? '' : 'hidden'}`}
                />
              </div>
            )}
            {notes.map((n) => <p key={n} className="text-[13px] text-warn" role="status">{n}</p>)}
          </section>
        </div>

        {message && <Notice level={message.level}>{message.text}</Notice>}

        {/* Toujours visible, même quand le contenu défile. */}
        <div className="sticky -bottom-6 -mx-6 -mb-6 flex flex-wrap justify-end gap-2.5 border-t bg-bg px-6 pb-6 pt-4" style={{ borderColor: 'var(--hairline)' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>{d.close}</button>
          <button type="button" className="btn btn-secondary" onClick={() => void copy()} disabled={!ready || busy !== null}>{d.copy}</button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!ready || busy !== null}>{busy === 'save' ? d.saving : d.save}</button>
        </div>
      </div>
    </Modal>,
    document.body,
  )
}
