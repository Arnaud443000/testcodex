import { describe, expect, it } from 'vitest'
import { ASSET_CATALOG } from './assetCatalog'
import { fold, searchInstruments } from './assetSearch'
import type { Instrument } from '../types/trade'

const ALL: Instrument[] = ASSET_CATALOG.map(([symbol, name, assetClass, defaultMultiplier], i) => ({
  id: i + 1,
  symbol,
  name,
  assetClass,
  defaultMultiplier,
}))
const symbols = (q: string) => searchInstruments(ALL, q).flatMap((g) => g.items.map((i) => i.symbol))

describe('catalogue d’actifs', () => {
  it('n’a aucun doublon de symbole et des multiplicateurs valides', () => {
    const keys = ALL.map((i) => i.symbol.replace(/[^A-Za-z0-9.]/g, '').toUpperCase())
    expect(new Set(keys).size).toBe(keys.length)
    for (const i of ALL) expect(i.defaultMultiplier).toMatch(/^[0-9]+(\.[0-9]+)?$/)
  })

  it('contient les grandes familles demandées', () => {
    const classes = new Set(ALL.map((i) => i.assetClass))
    for (const c of ['index', 'crypto', 'forex', 'commodity', 'stock']) expect(classes.has(c as never)).toBe(true)
    expect(ALL.filter((i) => i.assetClass === 'crypto').length).toBeGreaterThanOrEqual(50)
    expect(symbols('s&p')).toContain('US500')
    expect(symbols('nasdaq')).toContain('NAS100')
  })
})

describe('searchInstruments', () => {
  it('« sol » trouve Solana (nom et symbole), sans tenir compte de la casse', () => {
    expect(symbols('sol')[0]).toBe('SOLUSD')
    expect(symbols('SOL')).toContain('SOLUSD')
    expect(symbols('Solana')).toEqual(['SOLUSD'])
  })

  it('ignore les accents dans la requête et dans les noms', () => {
    expect(fold('Pétrole')).toBe('petrole')
    expect(symbols('petrole')).toEqual(expect.arrayContaining(['USOIL', 'UKOIL']))
    expect(symbols('PÉTROLE')).toEqual(expect.arrayContaining(['USOIL', 'UKOIL']))
    expect(symbols('yen')).toContain('USDJPY')
  })

  it('trouve par symbole avec ou sans séparateur', () => {
    expect(symbols('eurusd')[0]).toBe('EURUSD')
    expect(symbols('eur/usd')[0]).toBe('EURUSD')
    expect(symbols('eur usd')[0]).toBe('EURUSD')
  })

  it('place le symbole exact avant les correspondances partielles', () => {
    expect(symbols('btc')[0]).toBe('BTCUSD')
    expect(symbols('eth')[0]).toBe('ETHUSD')
  })

  it('groupe par classe d’actif dans l’ordre indices, crypto, devises, matières, actions', () => {
    const groups = searchInstruments(ALL, '')
    expect(groups.map((g) => g.assetClass)).toEqual(['index', 'crypto', 'forex', 'commodity', 'stock'])
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(ALL.length)
  })

  it('renvoie une liste vide si rien ne correspond', () => {
    expect(searchInstruments(ALL, 'zzzzqq')).toEqual([])
  })
})
