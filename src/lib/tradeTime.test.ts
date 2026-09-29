import { describe, expect, it } from 'vitest'
import { fromLocalInput, toLocalInput, tzOffsetMinutes } from './tradeTime'

describe('tradeTime', () => {
  it('fait l’aller-retour entre ms UTC et champ datetime-local', () => {
    const ms = new Date(2026, 8, 28, 9, 42).getTime() // heure locale de l'ordinateur
    expect(toLocalInput(ms)).toBe('2026-09-28T09:42')
    expect(fromLocalInput('2026-09-28T09:42')).toBe(ms)
  })
  it('refuse une saisie incomplète', () => {
    expect(fromLocalInput('')).toBeNull()
    expect(fromLocalInput('2026-09-28')).toBeNull()
    expect(fromLocalInput('2026-13-40T99:99')).toBeNull()
  })
  it('donne un décalage entier en minutes', () => {
    expect(Number.isInteger(tzOffsetMinutes(Date.now()))).toBe(true)
  })
})
