/** Logique pure de la case à cocher (`components/ui/Checkbox.tsx`), testée sous Node. */

/** Ce que la case dessine : vide, cochée (coche), indéterminée (tiret) ou « non respectée » (croix, pour une règle). */
export type CheckVisual = 'off' | 'on' | 'mixed' | 'bad'

/** L'indéterminé l'emporte sur coché / non coché (comme `input.indeterminate`). */
export function checkVisual(checked: boolean, indeterminate = false, bad = false): CheckVisual {
  if (indeterminate) return 'mixed'
  if (bad) return 'bad'
  return checked ? 'on' : 'off'
}

/** Valeur après un clic : une case indéterminée devient cochée, puis on alterne (comme une case native). */
export function nextChecked(checked: boolean, indeterminate = false): boolean {
  return indeterminate ? true : !checked
}

/** Valeur de `aria-checked` équivalente (le vrai `<input>` la porte déjà ; sert aux tests et aux visuels sans `<input>`). */
export function ariaChecked(visual: CheckVisual): 'true' | 'false' | 'mixed' {
  return visual === 'on' ? 'true' : visual === 'mixed' ? 'mixed' : 'false'
}
