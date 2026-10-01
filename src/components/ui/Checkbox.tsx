import { useEffect, useRef, type ReactNode } from 'react'
import { checkVisual, type CheckVisual } from '../../lib/checkboxModel'
import { Icon } from '../Icon'

/**
 * Dessin de la case (charte 5.5 : 19 px, rayon `sm`, cochée = dégradé). La forme porte le sens, jamais la couleur seule :
 * coche = cochée, tiret = indéterminée, croix = non respectée, carré vide = non cochée.
 */
export function CheckMark({ visual, peer = false, disabled = false, className = '' }: { visual: CheckVisual; peer?: boolean; disabled?: boolean; className?: string }) {
  const filled = visual === 'on' || visual === 'mixed'
  return (
    <span
      aria-hidden="true"
      className={`grid h-[19px] w-[19px] shrink-0 place-items-center rounded-sm border text-white transition ${className} ${
        peer ? 'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-violet' : ''
      } ${
        visual === 'bad'
          ? 'border-loss text-loss'
          : filled
            ? 'border-transparent'
            : disabled
              ? 'border-white/40'
              : 'border-white/25 group-hover:border-white/55'
      }`}
      style={filled ? { background: 'var(--grad)' } : undefined}
    >
      {visual === 'on' && <Icon name="check" size={13} />}
      {visual === 'mixed' && <Icon name="minus" size={13} />}
      {visual === 'bad' && <Icon name="cross" size={13} />}
    </span>
  )
}

/**
 * Case à cocher unique de Pulse (lot 29) : remplace tout `<input type="checkbox">` natif. C'est toujours un vrai `<input>`
 * (clavier, lecteurs d'écran), transparent, posé sur le dessin de la case ; toute la ligne (case + libellé) est la cible du clic
 * (le libellé active l'`<input>` par son `<label>`), 24 px de haut minimum.
 * `onChange` reçoit la nouvelle valeur. `indeterminate` : état « mixte » (aria-checked = mixed), un clic la coche.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  indeterminate = false,
  align = 'center',
  className = '',
  id,
  testId,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  /** Phrase d'aide sous le libellé, dans la zone cliquable. */
  description?: ReactNode
  disabled?: boolean
  indeterminate?: boolean
  /** `start` : la case s'aligne sur la première ligne d'un libellé long. */
  align?: 'center' | 'start'
  className?: string
  id?: string
  testId?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (input.current) input.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <label
      className={`group relative inline-flex min-h-[24px] max-w-full gap-2.5 text-sm ${align === 'start' ? 'items-start' : 'items-center'} ${
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      } ${className}`}
    >
      <span className={`relative grid shrink-0 ${align === 'start' ? 'mt-px' : ''}`}>
        <input
          ref={input}
          id={id}
          type="checkbox"
          className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          checked={checked}
          disabled={disabled}
          data-testid={testId}
          onChange={(e) => onChange(e.target.checked)}
        />
        <CheckMark visual={checkVisual(checked, indeterminate)} peer disabled={disabled} />
      </span>
      <span className="min-w-0">
        {label}
        {description && <span className="mt-0.5 block text-[13px] text-tx3">{description}</span>}
      </span>
    </label>
  )
}
