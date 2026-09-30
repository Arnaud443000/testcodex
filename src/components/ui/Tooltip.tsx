import { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { hasContent, placeTooltip, TOOLTIP_DELAY_MS, type TooltipPlacement } from '../../lib/tooltipModel'

/** Une seule infobulle à la fois (comme `title=`) : celle du plus petit élément survolé l'emporte sur celle de son conteneur. */
let closeCurrent: (() => void) | null = null

type ChildProps = {
  ref?: Ref<Element>
  'aria-describedby'?: string
  tabIndex?: number
  onMouseEnter?: (e: React.MouseEvent) => void
  onMouseLeave?: (e: React.MouseEvent) => void
  onMouseDown?: (e: React.MouseEvent) => void
  onFocus?: (e: React.FocusEvent) => void
  onBlur?: (e: React.FocusEvent) => void
}

/**
 * Infobulle unique de Pulse (lot 29) : remplace l'attribut natif `title=` et les petites bulles « i ». Verre sombre, police Inter,
 * rendue dans un portail (jamais coupée), repositionnée pour rester dans la fenêtre, apparaît après ~250 ms au survol **et** au focus
 * clavier, se ferme avec Échap, au clic et au défilement. `aria-describedby` la relie à son élément tant qu'elle est affichée.
 * Sans animation quand les effets sont réduits (`index.css`).
 *
 * `children` : **un seul élément DOM** (span, button, Link, th…, ou un élément SVG) qui reçoit les écouteurs. Un contenu vide
 * (`undefined`, `''`) laisse l'élément tel quel : `content={cond ? texte : undefined}` est permis.
 * `focusable` : ajoute `tabIndex=0` (pour une icône « i » qui n'est ni un bouton ni un lien, afin que le clavier l'atteigne).
 */
export function Tooltip({
  content,
  children,
  focusable = false,
  delay = TOOLTIP_DELAY_MS,
}: {
  content: ReactNode
  children: ReactElement<ChildProps>
  focusable?: boolean
  delay?: number
}) {
  const id = useId()
  const target = useRef<Element | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<TooltipPlacement | null>(null)
  const active = hasContent(content)

  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  const hide = useCallback(() => {
    clear()
    if (closeCurrent === hide) closeCurrent = null
    setOpen(false)
    setPlace(null)
  }, [])
  const show = useCallback(() => {
    clear()
    timer.current = setTimeout(() => {
      if (closeCurrent && closeCurrent !== hide) closeCurrent()
      closeCurrent = hide
      setOpen(true)
    }, delay)
  }, [delay, hide])

  useEffect(
    () => () => {
      clear()
      if (closeCurrent === hide) closeCurrent = null
    },
    [hide],
  )

  // Mesure l'infobulle puis la place ; tant qu'elle n'est pas placée, elle reste invisible.
  useLayoutEffect(() => {
    if (!open || !target.current || !panel.current) return
    const r = target.current.getBoundingClientRect()
    const p = panel.current.getBoundingClientRect()
    setPlace(
      placeTooltip(
        { left: r.left, top: r.top, width: r.width, height: r.height },
        { width: p.width, height: p.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
  }, [open, content])

  // Échap ferme (sans fermer la boîte de dialogue autour) ; défilement / redimensionnement : la cible a bougé, on ferme.
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        hide()
      }
    }
    document.addEventListener('keydown', key, true)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('keydown', key, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [open, hide])

  if (!active) return children

  const props = children.props
  const setRef = (node: Element | null) => {
    target.current = node
    const forwarded = props.ref
    if (typeof forwarded === 'function') forwarded(node)
    else if (forwarded && typeof forwarded === 'object') (forwarded as { current: Element | null }).current = node
  }
  const trigger = cloneElement(children, {
    ref: setRef,
    'aria-describedby': open ? [props['aria-describedby'], id].filter(Boolean).join(' ') : props['aria-describedby'],
    tabIndex: focusable && props.tabIndex === undefined ? 0 : props.tabIndex,
    onMouseEnter: (e: React.MouseEvent) => {
      props.onMouseEnter?.(e)
      show()
    },
    onMouseLeave: (e: React.MouseEvent) => {
      props.onMouseLeave?.(e)
      hide()
    },
    onMouseDown: (e: React.MouseEvent) => {
      props.onMouseDown?.(e)
      hide()
    },
    onFocus: (e: React.FocusEvent) => {
      props.onFocus?.(e)
      // Au focus clavier seulement : un clic qui donne le focus ne doit pas rouvrir l'infobulle qu'il vient de fermer.
      let keyboard = true
      try {
        keyboard = (e.currentTarget as Element).matches(':focus-visible')
      } catch {
        /* navigateur sans :focus-visible : on affiche */
      }
      if (keyboard) show()
    },
    onBlur: (e: React.FocusEvent) => {
      props.onBlur?.(e)
      hide()
    },
  })

  return (
    <>
      {trigger}
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="tooltip"
            data-side={place?.side}
            className="tooltip-panel"
            style={{ left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? 'visible' : 'hidden', ['--arrow-x' as string]: `${place?.arrowLeft ?? 0}px` }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  )
}
