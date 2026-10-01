import { describe, expect, it } from 'vitest'
import { applyEffects, EFFECTS_STORAGE_KEY, parsePreference, readPreference, resolveEffects, writePreference } from './effects'

const memory = (initial: Record<string, string> = {}) => {
  const data = { ...initial }
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v), data }
}

describe('réglage « Réduire les effets »', () => {
  it('« auto » suit la préférence du système', () => {
    expect(resolveEffects('auto', true)).toBe('reduced')
    expect(resolveEffects('auto', false)).toBe('full')
  })
  it('un choix explicite l\'emporte sur le système', () => {
    expect(resolveEffects('reduced', false)).toBe('reduced')
    expect(resolveEffects('full', true)).toBe('full')
  })
  it('une valeur inconnue ou absente vaut « auto »', () => {
    expect(parsePreference('n’importe quoi')).toBe('auto')
    expect(parsePreference(null)).toBe('auto')
    expect(readPreference(memory())).toBe('auto')
  })
  it('la préférence est mémorisée et relue', () => {
    const s = memory()
    writePreference('reduced', s)
    expect(s.data[EFFECTS_STORAGE_KEY]).toBe('reduced')
    expect(readPreference(s)).toBe('reduced')
  })
  it('un stockage qui refuse de lire ou d\'écrire ne casse rien', () => {
    const broken = { getItem: () => { throw new Error('refusé') }, setItem: () => { throw new Error('refusé') } }
    expect(readPreference(broken)).toBe('auto')
    expect(() => writePreference('full', broken)).not.toThrow()
    expect(readPreference(null)).toBe('auto')
  })
  it('le mode est écrit sur l\'élément racine', () => {
    const root = { dataset: {} } as unknown as HTMLElement
    applyEffects('reduced', root)
    expect(root.dataset.effects).toBe('reduced')
  })
})
