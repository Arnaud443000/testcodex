import { describe, expect, it } from 'vitest'
import { compareDecimal, isPlainDecimal, isPositiveDecimal, normalizeDecimalInput, parseDecimalInput, signOf, trimDecimal } from './decimal'

describe('compareDecimal', () => {
  it('compare sans flottant, même au-delà de 2^53', () => {
    expect(compareDecimal('90071992547409931.25', '90071992547409931.24')).toBe(1)
    expect(compareDecimal('1.0842', '1.08420')).toBe(0)
    expect(compareDecimal('9', '10')).toBe(-1)
    expect(compareDecimal('0.5', '0.05')).toBe(1)
  })
  it('gère les signes et le zéro négatif', () => {
    expect(compareDecimal('-5', '3')).toBe(-1)
    expect(compareDecimal('-5', '-10')).toBe(1)
    expect(compareDecimal('-0.00', '0')).toBe(0)
    expect(signOf('-0.000')).toBe(0)
    expect(signOf('-0.001')).toBe(-1)
    expect(signOf('12')).toBe(1)
  })
})

describe('trimDecimal', () => {
  it('retire les zéros superflus sans changer la valeur', () => {
    expect(trimDecimal('341.600000')).toBe('341.60')
    expect(trimDecimal('348')).toBe('348.00')
    expect(trimDecimal('-12.500')).toBe('-12.50')
    expect(trimDecimal('0.0042000')).toBe('0.0042')
    expect(trimDecimal('-0.000')).toBe('0.00')
  })
})

describe('saisie décimale', () => {
  it('accepte la virgule française', () => {
    expect(normalizeDecimalInput(' 1,0842 ')).toBe('1.0842')
    expect(isPlainDecimal('1,0842')).toBe(true)
    expect(isPlainDecimal('12')).toBe(true)
  })
  it('refuse ce que pulse-core refuse', () => {
    for (const bad of ['', 'abc', '1e5', '1.2.3', '-1', '.5', '1,5,2', '12$']) expect(isPlainDecimal(bad)).toBe(false)
    expect(isPlainDecimal('-1', { allowNegative: true })).toBe(true)
  })
  it('distingue le strictement positif', () => {
    expect(isPositiveDecimal('0')).toBe(false)
    expect(isPositiveDecimal('0.00')).toBe(false)
    expect(isPositiveDecimal('0.01')).toBe(true)
  })
})

describe('espaces de milliers (bug « 100 000 »)', () => {
  it('sont retirées à la normalisation, partout où une saisie est lue', () => {
    expect(normalizeDecimalInput('100 000')).toBe('100000')
    expect(normalizeDecimalInput('1\u00a0000,50')).toBe('1000.50')
    expect(normalizeDecimalInput('100\u202f000')).toBe('100000')
    expect(isPlainDecimal('1 000')).toBe(true)
  })
})

describe('parseDecimalInput', () => {
  it('lit un montant à la française en chaîne exacte', () => {
    expect(parseDecimalInput('100 000')).toBe('100000')
    expect(parseDecimalInput('10 000')).toBe('10000')
    expect(parseDecimalInput('10 000,50')).toBe('10000.50')
    expect(parseDecimalInput('90071992547409931,25')).toBe('90071992547409931.25')
  })
  it('traite une saisie vide comme zéro', () => {
    expect(parseDecimalInput('')).toBe('0')
    expect(parseDecimalInput('   ')).toBe('0')
  })
  it('refuse les valeurs invalides ou négatives', () => {
    for (const bad of ['-5', 'abc', '1e5', '1,5,2', '12$']) expect(parseDecimalInput(bad)).toBeNull()
  })
})
