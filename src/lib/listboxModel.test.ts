import { describe, expect, it } from 'vitest'
import { firstEnabled, lastEnabled, moveActive, placePanel, sectionize, selectedLabel, startIndex, typeAhead, type SelectOption } from './listboxModel'

const opts: SelectOption[] = [
  { value: 'a', label: 'Asie' },
  { value: 'l', label: 'Londres' },
  { value: 'x', label: 'Désactivée', disabled: true },
  { value: 'n', label: 'New York' },
  { value: 'e', label: 'Écart' },
]

describe('listboxModel', () => {
  it('saute les options désactivées au clavier, sans boucler', () => {
    expect(moveActive(opts, 1, 1)).toBe(3)
    expect(moveActive(opts, 3, -1)).toBe(1)
    expect(moveActive(opts, 4, 1)).toBe(4)
    expect(moveActive(opts, 0, -1)).toBe(0)
    expect(moveActive(opts, 0, 1, 10)).toBe(4) // PageDown : s'arrête à la dernière activable
  })
  it('Début / Fin ignorent les options désactivées', () => {
    expect(firstEnabled([{ value: 'x', label: 'x', disabled: true }, ...opts])).toBe(1)
    expect(lastEnabled([...opts, { value: 'z', label: 'z', disabled: true }])).toBe(4)
    expect(firstEnabled([])).toBe(-1)
    expect(lastEnabled([{ value: 'x', label: 'x', disabled: true }])).toBe(-1)
  })
  it('saut par frappe : préfixe, accents ignorés, même lettre répétée', () => {
    expect(typeAhead(opts, 0, 'n')).toBe(3)
    expect(typeAhead(opts, 0, 'new')).toBe(3)
    expect(typeAhead(opts, 0, 'ec')).toBe(4) // « Écart » sans l'accent
    expect(typeAhead(opts, 0, 'x')).toBe(-1)
    expect(typeAhead(opts, 0, 'd')).toBe(-1) // « Désactivée » est désactivée
    expect(typeAhead(opts, 0, '')).toBe(-1)
    const same = [{ value: '1', label: 'Alpha' }, { value: '2', label: 'Alto' }, { value: '3', label: 'Beta' }]
    expect(typeAhead(same, 0, 'a')).toBe(1) // une lettre : option suivante qui commence par elle
    expect(typeAhead(same, 1, 'a')).toBe(0)
    expect(typeAhead(same, 0, 'aa')).toBe(1) // lettre répétée : on parcourt
  })
  it("l'index de départ est l'option choisie, sinon la première activable", () => {
    expect(startIndex(opts, 'n')).toBe(3)
    expect(startIndex(opts, 'x')).toBe(0) // désactivée
    expect(startIndex(opts, 'inconnue')).toBe(0)
    expect(startIndex([], '')).toBe(-1)
  })
  it('regroupe les options consécutives et garde le rang à plat', () => {
    const s = sectionize([
      { value: '1', label: 'Un', group: 'Livrés' },
      { value: '2', label: 'Deux', group: 'Livrés' },
      { value: '3', label: 'Trois', group: 'Les miens' },
      { value: '4', label: 'Quatre' },
    ])
    expect(s.map((x) => [x.group, x.items.map((i) => i.index)])).toEqual([
      ['Livrés', [0, 1]],
      ['Les miens', [2]],
      [null, [3]],
    ])
    expect(sectionize([])).toEqual([])
  })
  it("s'ouvre vers le haut s'il n'y a pas de place en bas", () => {
    expect(placePanel(500, 100, 320)).toEqual({ side: 'below', maxHeight: 320 })
    expect(placePanel(150, 600, 320)).toEqual({ side: 'above', maxHeight: 320 })
    expect(placePanel(200, 180, 320)).toEqual({ side: 'below', maxHeight: 192 }) // ni l'un ni l'autre : le plus grand côté
    expect(placePanel(10, 10, 320).maxHeight).toBe(96) // jamais un panneau minuscule
  })
  it('libellé choisi', () => {
    expect(selectedLabel(opts, 'l')).toBe('Londres')
    expect(selectedLabel(opts, 'zzz')).toBeNull()
  })
})
