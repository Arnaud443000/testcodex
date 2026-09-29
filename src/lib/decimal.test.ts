import { describe, expect, it } from 'vitest'
import { parseDecimalInput } from './decimal'

describe('parseDecimalInput', () => {
  it('accepte les milliers séparés par une espace (le bug « 100 000 »)', () => {
    expect(parseDecimalInput('100 000')).toBe('100000')
    expect(parseDecimalInput('10 000')).toBe('10000')
    expect(parseDecimalInput('1 000 000')).toBe('1000000')
  })
  it('accepte les espaces insécables produites par le copier-coller', () => {
    expect(parseDecimalInput('100 000')).toBe('100000')
    expect(parseDecimalInput('100 000')).toBe('100000')
  })
  it('accepte la virgule ou le point comme séparateur décimal', () => {
    expect(parseDecimalInput('10 000,50')).toBe('10000.50')
    expect(parseDecimalInput('10000.5')).toBe('10000.5')
  })
  it('garde tous les chiffres sans passer par un flottant', () => {
    expect(parseDecimalInput('90071992547409931,25')).toBe('90071992547409931.25')
  })
  it('traite une saisie vide comme zéro', () => {
    expect(parseDecimalInput('')).toBe('0')
    expect(parseDecimalInput('   ')).toBe('0')
  })
  it('refuse les valeurs invalides ou négatives', () => {
    expect(parseDecimalInput('-5')).toBeNull()
    expect(parseDecimalInput('abc')).toBeNull()
    expect(parseDecimalInput('1e5')).toBeNull()
    expect(parseDecimalInput('1,5,2')).toBeNull()
    expect(parseDecimalInput('12$')).toBeNull()
  })
})
