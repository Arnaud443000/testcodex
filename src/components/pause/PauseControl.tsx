import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../i18n'
import { usePause } from '../../lib/pause'
import { endClock } from '../../lib/pauseView'
import { Icon } from '../Icon'
import { Tooltip } from '../ui/Tooltip'
import { useFloatingBox } from '../ui/useFloatingBox'
import { PausePicker } from './PausePicker'

/**
 * Repère de la barre du haut : un bouton discret « Pause » (qui ouvre le choix), ou, pendant une pause, la
 * puce « Pause jusqu'à 15:40 » avec les minutes restantes et « Terminer la pause ». C'est un élément de la
 * barre, dans le flux : il ne recouvre jamais le contenu. Un rappel, jamais un blocage.
 */
export function PauseControl() {
  const t = useT().pause
  const { current, remainingMin, end } = usePause()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const anchor = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const box = useFloatingBox(anchor, open, 560, 400)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      const target = e.target as Node
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  if (current) {
    const { time, tomorrow } = endClock(current.pause.plannedEndAt, Date.now())
    return (
      <div className="relative">
        <div className="control flex items-center gap-2.5 !rounded-full py-1 pl-3.5 pr-1.5 text-sm whitespace-nowrap" role="group" aria-label={t.topbar.chipLabel} data-testid="pause-chip">
          <span className="text-violet"><Icon name="pause" size={18} /></span>
          <span className="font-semibold">{t.topbar.until(tomorrow ? t.topbar.tomorrow(time) : time)}</span>
          <Tooltip content={remainingMin <= 1 ? t.topbar.remainingLast : t.topbar.remaining(remainingMin)}>
            <span className="tabular-nums text-tx2">
              {remainingMin <= 1 ? '< 1\u00A0min' : t.topbar.remainingShort(remainingMin)}
              <span className="sr-only">{remainingMin <= 1 ? ` ${t.topbar.remainingLast}` : t.topbar.remainingSuffix}</span>
            </span>
          </Tooltip>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-label={t.topbar.endButton}
            onClick={() => {
              setError(null)
              end().catch((e) => setError(t.picker.endError(String(e instanceof Error ? e.message : e))))
            }}
          >
            {t.topbar.endShort}
          </button>
        </div>
        {error && <div className="nt nt-bad absolute right-0 top-[calc(100%+8px)] z-40 w-[320px]" role="alert">{error}</div>}
      </div>
    )
  }

  return (
    <div className="relative">
      <Tooltip content={t.topbar.buttonTitle}>
        <button ref={anchor} type="button" className="btn btn-secondary" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
          <Icon name="pause" size={18} /> {t.topbar.button}
        </button>
      </Tooltip>
      {open &&
        box &&
        createPortal(
          // Dans un portail : la barre du haut est sous le contenu de la page (elle crée son propre empilement), un panneau
          // posé dedans serait recouvert. Fixe et opaque, il disparaît au clic dehors ou à Échap.
          <div
            ref={panel}
            className="popover-panel pop-scroll !p-5"
            data-testid="pause-popover"
            style={{ position: 'fixed', left: box.left, top: box.top, bottom: box.bottom, width: box.width, maxWidth: 'calc(100vw - 16px)', maxHeight: box.maxHeight }}
          >
            <PausePicker focusOnOpen onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
          </div>,
          document.body,
        )}
    </div>
  )
}
