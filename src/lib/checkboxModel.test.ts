import { describe, expect, it } from 'vitest'
import { ariaChecked, checkVisual, nextChecked } from './checkboxModel'

describe('checkboxModel', () => {
  it('dessine coché, non coché, indéterminé et non respecté', () => {
    expect(checkVisual(true)).toBe('on')
    expect(checkVisual(false)).toBe('off')
    expect(checkVisual(false, true)).toBe('mixed')
    expect(checkVisual(true, true)).toBe('mixed') // l'indéterminé l'emporte
    expect(checkVisual(false, false, true)).toBe('bad')
    expect(checkVisual(true, false, true)).toBe('bad') // une règle non respectée n'est jamais dessinée « cochée »
  })
  it('un clic alterne, et une case indéterminée devient cochée', () => {
    expect(nextChecked(false)).toBe(true)
    expect(nextChecked(true)).toBe(false)
    expect(nextChecked(false, true)).toBe(true)
    expect(nextChecked(true, true)).toBe(true)
  })
  it('aria-checked : true, false ou mixed', () => {
    expect(ariaChecked('on')).toBe('true')
    expect(ariaChecked('off')).toBe('false')
    expect(ariaChecked('bad')).toBe('false')
    expect(ariaChecked('mixed')).toBe('mixed')
  })
})
