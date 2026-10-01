import { useCallback, useLayoutEffect, useState, type RefObject } from 'react'
import { placePanel } from '../../lib/listboxModel'

export type FloatingBox = { left: number; top?: number; bottom?: number; width: number; maxHeight: number; side: 'below' | 'above' }

/**
 * Position d'un panneau flottant (menus, sélecteur d'actif) rendu dans un portail : sous l'élément, ou au-dessus s'il n'y a pas
 * la place en bas ; ramené dans la fenêtre ; recalculé au défilement et au redimensionnement tant qu'il est ouvert.
 * `wanted` : hauteur souhaitée du panneau, en pixels. Renvoie `null` tant qu'il n'est pas ouvert.
 */
export function useFloatingBox(anchor: RefObject<HTMLElement | null>, open: boolean, wanted: number, minWidth = 160): FloatingBox | null {
  const [box, setBox] = useState<FloatingBox | null>(null)
  const place = useCallback(() => {
    const el = anchor.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const p = placePanel(window.innerHeight - r.bottom - 6, r.top - 6, wanted)
    const width = Math.max(r.width, minWidth)
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    setBox(
      p.side === 'below'
        ? { left, top: r.bottom + 6, width, maxHeight: p.maxHeight, side: 'below' }
        : { left, bottom: window.innerHeight - r.top + 6, width, maxHeight: p.maxHeight, side: 'above' },
    )
  }, [anchor, wanted, minWidth])
  useLayoutEffect(() => {
    if (!open) {
      setBox(null)
      return
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])
  return open ? box : null
}
