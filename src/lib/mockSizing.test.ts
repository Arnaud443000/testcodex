import { describe, expect, it } from 'vitest'
import { mock, mockSizing } from './mockBackend'
import { defaultSizeStep, mockSize, type MockSizingInput } from './mockSizing'
import { compareDecimal } from './decimal'
import type { Sizing, SizingOutcome } from '../types/sizing'

/** Mêmes cas, calculés à la main, que `pulse-core/src/sizing/tests.rs` : forex EURUSD = multiplicateur 100 000, pas 0,01. */
const base = (over: Partial<MockSizingInput> = {}): MockSizingInput => ({
  direction: 'long', entry: '1.1000', stop: '1.0950', takeProfit: null, riskMode: 'percent', riskValue: '1',
  balance: '10000', multiplier: '100000', sizeStep: '0.01', sizeStepIsDefault: true, maxRiskPercent: null,
  ...over,
})
const ok = (i: MockSizingInput): Sizing => {
  const r = mockSize(i, 'USD')
  if (r.status !== 'ok') throw new Error(`refus inattendu : ${r.code}`)
  return r.result
}
const refusal = (i: MockSizingInput) => {
  const r = mockSize(i, 'USD')
  if (r.status !== 'refused') throw new Error('un refus était attendu')
  return r
}
const same = (a: string | null, b: string) => expect(a !== null && compareDecimal(a, b) === 0, `${a} ≠ ${b}`).toBe(true)

describe('calculateur de taille : faux backend = pulse-core', () => {
  it('forex long, 1 %', () => {
    const r = ok(base())
    expect(r.size).toBe('0.20')
    same(r.rawSize, '0.2'); same(r.riskWanted, '100'); same(r.riskActual, '100'); same(r.riskActualPercent, '1'); same(r.riskGap, '0')
    same(r.stopDistance, '0.005')
    expect(r.sizeStepIsDefault && !r.exceedsMaxRisk && r.rewardRisk === null).toBe(true)
  })

  it('risque en % et en montant : même taille', () => {
    expect(ok(base()).size).toBe(ok(base({ riskMode: 'amount', riskValue: '100' })).size)
  })

  it('arrondi vers le bas : le risque réel est strictement inférieur', () => {
    const r = ok(base({ stop: '1.0970' }))
    same(r.rawSize, '0.33333333')
    expect(r.size).toBe('0.33')
    same(r.riskActual, '99'); same(r.riskGap, '1'); same(r.riskActualPercent, '0.99')
    expect(compareDecimal(r.riskActual, r.riskWanted)).toBeLessThan(0)
  })

  it('indice avec take profit', () => {
    const r = ok(base({ entry: '18000', stop: '17950', takeProfit: '18150', riskValue: '0.5', balance: '25000', multiplier: '1' }))
    same(r.size, '2.5'); same(r.riskActual, '125'); same(r.rewardAmount, '375')
    expect(r.rewardRisk).toBe(3)
  })

  it('crypto : petits prix, 8 décimales', () => {
    const r = ok(base({ entry: '0.00001234', stop: '0.00001200', riskMode: 'amount', riskValue: '50', balance: '1000', multiplier: '1', sizeStep: '0.0001' }))
    same(r.size, '147058823.5294'); same(r.riskActual, '49.999999999996'); same(r.riskGap, '0.000000000004')
    same(ok(base({ entry: '0.00002000', stop: '0.00001500', riskMode: 'amount', riskValue: '10', balance: '1000', multiplier: '1' })).size, '2000000')
  })

  it('short', () => {
    const r = ok(base({ direction: 'short', stop: '1.1050', takeProfit: '1.0900', riskMode: 'amount', riskValue: '100' }))
    expect(r.size).toBe('0.20')
    same(r.rewardAmount, '200')
    expect(r.rewardRisk).toBe(2)
  })

  it('take profit du mauvais côté : pas de ratio, mais une taille', () => {
    for (const tp of ['1.0900', '1.1000']) {
      const r = ok(base({ takeProfit: tp }))
      expect(r.size).toBe('0.20')
      expect(r.takeProfitWrongSide && r.rewardRisk === null && r.rewardAmount === null).toBe(true)
    }
    expect(ok(base({ direction: 'short', stop: '1.1050', takeProfit: '1.1100' })).takeProfitWrongSide).toBe(true)
  })

  it('taille nulle : refus avec le risque de la taille minimum', () => {
    const r = refusal(base({ riskValue: '0.1', balance: '1000' }))
    expect(r.code).toBe('sizeZero')
    expect(r.detail).toBe('5')
  })

  it('limite de risque : dépassée, égalité respectée, sauvée par l’arrondi', () => {
    const lim = (over: Partial<MockSizingInput>) => ok(base({ maxRiskPercent: '1', ...over }))
    const over = lim({ riskValue: '2' })
    expect(over.size).toBe('0.40')
    expect(over.exceedsMaxRisk).toBe(true)
    same(over.maxRiskAmount, '100')
    expect(lim({}).exceedsMaxRisk).toBe(false)
    const saved = lim({ riskMode: 'amount', riskValue: '100.5' })
    expect(saved.size).toBe('0.20')
    expect(saved.exceedsMaxRisk).toBe(false)
    const fine = lim({ riskMode: 'amount', riskValue: '100.007', sizeStep: '0.00001' })
    same(fine.riskActual, '100.005')
    expect(fine.exceedsMaxRisk).toBe(true)
    expect(ok(base({ riskValue: '50' })).exceedsMaxRisk).toBe(false)
  })

  it('stop du mauvais côté ou égal à l’entrée', () => {
    expect(refusal(base({ stop: '1.1050' })).code).toBe('stopWrongSide')
    expect(refusal(base({ direction: 'short' })).code).toBe('stopWrongSide')
    expect(refusal(base({ stop: '1.1000' })).code).toBe('stopEqualsEntry')
    expect(refusal(base({ direction: 'short', stop: '1.10' })).code).toBe('stopEqualsEntry')
  })

  it('prix, risque, multiplicateur et pas invalides', () => {
    expect(refusal(base({ entry: '0' })).code).toBe('priceNotPositive')
    expect(refusal(base({ stop: '-1' })).code).toBe('priceNotPositive')
    expect(refusal(base({ takeProfit: '0' })).code).toBe('priceNotPositive')
    expect(refusal(base({ riskMode: 'amount', riskValue: '0' })).code).toBe('riskNotPositive')
    expect(refusal(base({ riskValue: '-1' })).code).toBe('riskNotPositive')
    expect(refusal(base({ riskValue: '100.01' })).code).toBe('riskPercentTooHigh')
    expect(refusal(base({ multiplier: '0' })).code).toBe('multiplierNotPositive')
    expect(refusal(base({ sizeStep: '0' })).code).toBe('stepNotPositive')
  })

  it('solde nul ou négatif', () => {
    expect(refusal(base({ balance: '0' })).code).toBe('balanceNotPositive')
    expect(refusal(base({ balance: '-50' })).code).toBe('balanceNotPositive')
    const r = ok(base({ riskMode: 'amount', riskValue: '100', balance: '-50', maxRiskPercent: '1' }))
    expect(r.size).toBe('0.20')
    expect(r.riskActualPercent === null && r.riskWantedPercent === null && r.maxRiskAmount === null && !r.exceedsMaxRisk).toBe(true)
  })

  it('pas de taille : actions entières et pas personnalisé', () => {
    same(ok(base({ entry: '50', stop: '48', multiplier: '1', sizeStep: '1' })).size, '50')
    const j = base({ entry: '50', stop: '48', riskMode: 'amount', riskValue: '105', multiplier: '1', sizeStep: '1' })
    same(ok(j).size, '52')
    const k = ok({ ...j, sizeStep: '5' })
    same(k.size, '50'); same(k.riskActual, '100'); same(k.riskGap, '5')
  })

  it('très grands nombres : refus « débordement », jamais un plantage', () => {
    same(ok(base({ entry: '100', stop: '99', riskMode: 'amount', riskValue: '100000000000000000000', multiplier: '1', sizeStep: '1' })).size, '100000000000000000000')
    expect(refusal(base({ entry: '100000000000000000000', stop: '50000000000000000000', riskMode: 'amount', riskValue: '100', multiplier: '10000000000' })).code).toBe('overflow')
  })

  it('pas par défaut par classe d’actif', () => {
    expect(['forex', 'index', 'commodity', 'other'].map((c) => defaultSizeStep(c as never))).toEqual(['0.01', '0.01', '0.01', '0.01'])
    expect(defaultSizeStep('crypto')).toBe('0.0001')
    expect(defaultSizeStep('stock')).toBe('1')
    expect(defaultSizeStep('future')).toBe('1')
  })
})

describe('calculateur de taille : via le faux backend (solde réel du compte)', () => {
  it('solde = capital + dépôts + PnL nets des trades clôturés (les trades ouverts ne comptent pas)', async () => {
    const account = (await mock.createAccount({ name: 'Calc', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
    const eurusd = (await mock.listInstruments()).find((i) => i.symbol === 'EURUSD')!
    await mock.createCashFlow({ accountId: account, kind: 'deposit', amount: '500', occurredAt: 1_000, tzOffsetMin: 0, note: '' })
    const t = { accountId: account, instrumentId: eurusd.id, direction: 'long' as const, size: '1', multiplier: '1', entryPrice: '100', tzOffsetMin: 0, plannedSl: null, fees: '0', thesis: '', postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [] }
    await mock.createTrade({ ...t, exitPrice: '90', entryTime: 2_000, exitTime: 3_000 })
    await mock.createTrade({ ...t, exitPrice: null, entryTime: 4_000, exitTime: null })
    await mock.setBehaviorSettings({ maxRiskPercent: null, maxTradesPerDay: null, revengeWindowMin: 60, revengeSizeFactor: '1.5' })
    const request = { accountId: account, instrumentId: eurusd.id, direction: 'long' as const, entryPrice: '1.1000', stopLoss: '1.0950', takeProfit: null, riskMode: 'percent' as const, riskValue: '1', multiplier: null, sizeStep: null }

    const out: SizingOutcome = await mockSizing.calculatePositionSize(request)
    if (out.status !== 'ok') throw new Error('résultat attendu')
    expect(out.currency).toBe('USD')
    same(out.result.balance, '10490'); same(out.result.riskWanted, '104.9'); expect(out.result.size).toBe('0.20'); same(out.result.riskGap, '4.9')

    const custom = await mockSizing.calculatePositionSize({ ...request, multiplier: '10', sizeStep: '1' })
    if (custom.status !== 'ok') throw new Error('résultat attendu')
    expect(custom.result.sizeStepIsDefault).toBe(false)
    same(custom.result.size, '2098')

    await mock.setBehaviorSettings({ maxRiskPercent: '0.9', maxTradesPerDay: null, revengeWindowMin: 60, revengeSizeFactor: '1.5' })
    const limited = await mockSizing.calculatePositionSize(request)
    if (limited.status !== 'ok') throw new Error('résultat attendu')
    expect(limited.result.exceedsMaxRisk).toBe(true)
    same(limited.result.maxRiskAmount, '94.41')
    await mock.setBehaviorSettings({ maxRiskPercent: null, maxTradesPerDay: null, revengeWindowMin: 60, revengeSizeFactor: '1.5' })

    const refused = await mockSizing.calculatePositionSize({ ...request, stopLoss: '1.1050' })
    expect(refused).toEqual({ status: 'refused', code: 'stopWrongSide', detail: null })
    await expect(mockSizing.calculatePositionSize({ ...request, accountId: 99999 })).rejects.toThrow(/not found/)
  })
})
