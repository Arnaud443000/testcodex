import { Children, createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../../i18n'
import { nextDensity, visibleRows } from '../../lib/cardFit'

/** Vrai quand la carte est posée dans un widget du dashboard : elle remplit sa cellule au lieu de prendre des colonnes. */
export const EmbeddedCardContext = createContext(false)

/**
 * Ajuste une carte de widget à la hauteur que la grille lui donne (lot 29) : si le contenu déborde, `data-density` passe à 1
 * (marges réduites) puis 2 (textes facultatifs `.fit-optional` masqués) — voir `index.css`. Repart de 0 quand la taille
 * change ou que le contenu est redessiné par son parent. Hors widget (`enabled = false`), ne fait rien.
 */
export function useCardDensity(ref: RefObject<HTMLElement | null>, enabled: boolean, content: unknown): number {
  const [level, setLevel] = useState(0)
  // Le parent a redessiné (nouvelles données, nouveau tri…) : on repart du contenu normal.
  useLayoutEffect(() => setLevel(0), [content])
  // Après chaque rendu : ça déborde encore ? un cran de plus.
  useLayoutEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const next = nextDensity(level, el.scrollHeight > el.clientHeight + 1)
    if (next !== level) setLevel(next)
  })
  // La carte change de taille (fenêtre, redimensionnement du widget) : on repart de zéro.
  useLayoutEffect(() => {
    const el = ref.current
    if (!enabled || !el || typeof ResizeObserver === 'undefined') return
    let first = true
    const obs = new ResizeObserver(() => {
      if (first) {
        first = false
        return
      }
      setLevel(0)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [enabled, ref])
  return enabled ? level : 0
}

/**
 * Liste de lignes dont le nombre s'adapte à la place disponible **dans un widget** : on garde les lignes qui tiennent entièrement,
 * puis « Voir les N autres » mène à la page complète. Hors widget (page), toutes les lignes sont affichées.
 * `children` : les lignes (éléments avec une clé) ; `as` : balise de la liste (`ul` par défaut).
 */
export function FitList({ children, moreTo, className = '', as: Tag = 'ul' }: { children: ReactNode; moreTo: string; className?: string; as?: 'ul' | 'div' }) {
  const embedded = useContext(EmbeddedCardContext)
  const t = useT().common
  const rows = Children.toArray(children)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLElement>(null)
  const [count, setCount] = useState<number | null>(null)

  // Nouveau contenu ou nouvelle taille : on affiche tout, puis on mesure.
  useLayoutEffect(() => setCount(null), [children])
  useLayoutEffect(() => {
    const el = box.current
    if (!embedded || !el || typeof ResizeObserver === 'undefined') return
    let first = true
    const obs = new ResizeObserver(() => {
      if (first) {
        first = false
        return
      }
      setCount(null)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [embedded])
  useLayoutEffect(() => {
    const el = box.current
    const ul = list.current
    if (!embedded || count !== null || !el || !ul) return
    const top = el.getBoundingClientRect().top
    const bottoms = [...ul.children].map((c) => c.getBoundingClientRect().bottom - top)
    setCount(visibleRows(bottoms, el.clientHeight))
  })

  if (!embedded) return <Tag className={className}>{children}</Tag>
  const shown = count === null ? rows.length : count
  return (
    <>
      <div ref={box} className="min-h-0 flex-1 overflow-hidden">
        <Tag ref={list as never} className={className}>
          {rows.slice(0, shown)}
        </Tag>
      </div>
      {shown < rows.length && (
        <Link to={moreTo} className="btn-link mt-1 shrink-0 self-start text-[13px]">
          {t.fitMore(rows.length - shown)}
        </Link>
      )}
    </>
  )
}

/** Carte de widget du tableau de bord (verre, hauteur fixée par la grille) qui se resserre quand son contenu déborde. */
export function FitCard({ children, className = '', testId }: { children: ReactNode; className?: string; testId?: string }) {
  const ref = useRef<HTMLElement>(null)
  const density = useCardDensity(ref, true, children)
  return (
    <section
      ref={ref}
      data-testid={testId}
      data-density={density > 0 ? density : undefined}
      className={`fit-card glass-card flex h-full flex-col pop-scroll p-6 ${className}`}
    >
      {children}
    </section>
  )
}
