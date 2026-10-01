/**
 * Logique pure du menu déroulant (`components/ui/Select.tsx`) : navigation au clavier, saut par frappe, regroupement,
 * placement du panneau. Aucun accès au DOM : tout est testé sous Node (`listboxModel.test.ts`).
 */

export type SelectOption = {
  value: string
  label: string
  disabled?: boolean
  /** Titre de groupe (équivalent d'un `<optgroup>`) ; les options de même groupe consécutives sont réunies. */
  group?: string
}

export type SelectSection = { group: string | null; items: { option: SelectOption; index: number }[] }

/** Réunit les options consécutives d'un même groupe ; `index` = rang dans la liste à plat (pour aria-activedescendant). */
export function sectionize(options: SelectOption[]): SelectSection[] {
  const sections: SelectSection[] = []
  options.forEach((option, index) => {
    const group = option.group ?? null
    const last = sections[sections.length - 1]
    if (last && last.group === group) last.items.push({ option, index })
    else sections.push({ group, items: [{ option, index }] })
  })
  return sections
}

/** Premier / dernier index activable (-1 s'il n'y en a aucun). */
export function firstEnabled(options: SelectOption[]): number {
  return options.findIndex((o) => !o.disabled)
}
export function lastEnabled(options: SelectOption[]): number {
  for (let i = options.length - 1; i >= 0; i -= 1) if (!options[i].disabled) return i
  return -1
}

/** Index activable suivant (`step` = 1) ou précédent (`step` = -1), sans boucler ; `from` inchangé si rien n'est atteignable. */
export function moveActive(options: SelectOption[], from: number, step: 1 | -1, amount = 1): number {
  let index = from
  let remaining = amount
  while (remaining > 0) {
    let next = index + step
    while (next >= 0 && next < options.length && options[next].disabled) next += step
    if (next < 0 || next >= options.length) break
    index = next
    remaining -= 1
  }
  return index
}

/**
 * Saut par frappe (« type-ahead ») : `typed` = caractères tapés depuis moins d'une seconde. Une même lettre répétée
 * parcourt les options qui commencent par elle ; sinon on cherche le premier libellé qui commence par `typed`, à partir de
 * l'option suivante (pour que la frappe d'une seule lettre passe à l'option suivante). Insensible à la casse et aux accents.
 */
export function typeAhead(options: SelectOption[], from: number, typed: string): number {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  const needle = norm(typed)
  if (needle === '') return -1
  const repeated = needle.length > 1 && [...needle].every((c) => c === needle[0])
  const key = repeated ? needle[0] : needle
  const n = options.length
  for (let offset = repeated || needle.length === 1 ? 1 : 0; offset <= n; offset += 1) {
    const i = (Math.max(from, 0) + offset) % n
    const o = options[i]
    if (!o.disabled && norm(o.label).startsWith(key)) return i
  }
  return -1
}

/** Index de départ à l'ouverture : l'option choisie si elle est activable, sinon la première activable. */
export function startIndex(options: SelectOption[], value: string): number {
  const i = options.findIndex((o) => o.value === value)
  return i >= 0 && !options[i].disabled ? i : firstEnabled(options)
}

export type Placement = { side: 'below' | 'above'; maxHeight: number }

/**
 * Où ouvrir le panneau : en dessous s'il y a la place pour `wanted` pixels (ou s'il y en a plus qu'au-dessus), sinon au-dessus.
 * `maxHeight` = hauteur réellement disponible du côté choisi (marge `margin` comprise), jamais au-delà de `wanted`.
 */
export function placePanel(spaceBelow: number, spaceAbove: number, wanted: number, margin = 8): Placement {
  const below = spaceBelow - margin
  const above = spaceAbove - margin
  const side = below >= wanted || below >= above ? 'below' : 'above'
  const room = side === 'below' ? below : above
  return { side, maxHeight: Math.max(Math.min(wanted, room), 96) }
}

/** Libellé du bouton : le libellé de l'option choisie, sinon l'invite (`placeholder`). */
export function selectedLabel(options: SelectOption[], value: string): string | null {
  return options.find((o) => o.value === value)?.label ?? null
}
