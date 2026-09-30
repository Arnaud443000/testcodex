import { describe, expect, it } from 'vitest'
import { EMOTION_CATALOG } from './emotionCatalog'
import { catalogView, formEmotions, myList, nameProblem, removalChoice } from './emotionList'
import type { Tag } from '../types/trade'

const tag = (id: number, name: string, archived = false, kind: Tag['kind'] = 'emotion'): Tag => ({ id, kind, name, archived })
const tags: Tag[] = [tag(1, 'Calme'), tag(2, 'Doute', true), tag(3, 'Stress'), tag(4, 'Breakout', false, 'setup'), tag(5, 'Avidité', true)]

describe('Ma liste', () => {
  it('ne garde que les émotions non archivées, par ordre alphabétique', () => {
    expect(myList(tags).map((t) => t.name)).toEqual(['Calme', 'Stress'])
    expect(myList([])).toEqual([])
  })

  it('état de chaque suggestion : dans la liste, retirée, disponible (casse et espaces ignorés)', () => {
    const view = catalogView(EMOTION_CATALOG, [...tags, tag(6, ' confiance  ')])
    const state = (name: string) => view.flatMap((g) => g.entries).find((e) => e.name === name)!.state
    expect(state('Calme')).toBe('inList')
    expect(state('Confiance')).toBe('inList')
    expect(state('Doute')).toBe('archived')
    expect(state('Avidité')).toBe('archived')
    expect(state('Colère')).toBe('available')
    // Un tag d'un autre genre ne compte pas : « Breakout » n'est pas une émotion.
    expect(catalogView([{ key: 'k', label: 'K', emotions: ['Breakout'] }], tags)[0].entries[0].state).toBe('available')
    expect(view.map((g) => g.key)).toEqual(EMOTION_CATALOG.map((g) => g.key))
  })
})

describe('émotions du formulaire de trade', () => {
  it('propose Ma liste, puis les émotions cochées retirées depuis (trade en modification)', () => {
    expect(formEmotions(tags, []).map((e) => [e.tag.name, e.removed])).toEqual([['Calme', false], ['Stress', false]])
    const editing = formEmotions(tags, [2, 1])
    expect(editing.map((e) => [e.tag.name, e.removed])).toEqual([['Calme', false], ['Stress', false], ['Doute', true]])
    // Une émotion archivée non cochée reste cachée ; un tag qui n'est pas une émotion n'apparaît jamais.
    expect(formEmotions(tags, [4]).map((e) => e.tag.id)).toEqual([1, 3])
  })
})

describe('saisie libre', () => {
  it('refuse le vide, le trop long et le doublon déjà dans la liste', () => {
    expect(nameProblem('   ', tags)).toBe('empty')
    expect(nameProblem('x'.repeat(41), tags)).toBe('tooLong')
    expect(nameProblem('x'.repeat(40), tags)).toBeNull()
    expect(nameProblem('  CALME ', tags)).toBe('inList')
  })
  it('accepte une émotion retirée (elle sera réactivée) et un nom nouveau', () => {
    expect(nameProblem('doute', tags)).toBeNull()
    expect(nameProblem('Méfiance', tags)).toBeNull()
  })
})

describe('retirer ou supprimer', () => {
  it('la suppression définitive n’est possible que pour une émotion jamais utilisée', () => {
    const usage = [{ tagId: 1, tradeCount: 3 }, { tagId: 3, tradeCount: 0 }]
    expect(removalChoice(1, usage)).toEqual({ tradeCount: 3, canDelete: false })
    expect(removalChoice(3, usage)).toEqual({ tradeCount: 0, canDelete: true })
    expect(removalChoice(99, usage).canDelete).toBe(true)
  })
})
