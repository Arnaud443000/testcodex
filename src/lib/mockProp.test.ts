import { describe, expect, it } from 'vitest'
import type { Account } from '../types/account'
import type { PropRulesInput } from '../types/prop'
import {
  computeProp,
  createPropMock,
  dayKeyOf,
  dropImprovements,
  evaluatePropAlerts,
  parseTime,
  resetInstant,
  tradingDay,
  validatePropRules,
  type MockClosedTrade,
} from './mockProp'

/**
 * Miroir de `crates/pulse-core/src/prop/tests.rs` et `alerts/prop/tests.rs` : MÊMES cas, mêmes résultats
 * (montants comparés à l'échelle près : « 2500 » pour le « 2500.0 » de Rust).
 * Journal P1 : capital 100 000, perte journalière 5 % du capital initial (5 000), perte maximale 10 % statique
 * (10 000, plancher 90 000), remise à zéro 00:00 Paris, défi commencé le 2026-09-01.
 */

const MIN = 60_000
const HOUR = 60 * MIN
const at = (y: number, m: number, d: number, h: number, min = 0) => Date.UTC(y, m - 1, d, h, min)
const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / (24 * HOUR)
/** 2026-09-15 15:00 UTC = 17:00 à Paris. */
const NOW = at(2026, 9, 15, 15)

const limit = (mode: string, value: string) => ({ mode, value })
const p1 = (over: Partial<PropRulesInput> = {}): PropRulesInput => ({
  phaseLabel: 'Évaluation 1',
  startedOn: '2026-09-01',
  dailyLoss: limit('percent', '5'),
  dailyReference: 'initialBalance',
  maxLoss: limit('percent', '10'),
  maxLossKind: 'static',
  trailingLocksAtInitial: false,
  resetTime: '00:00',
  resetZone: 'paris',
  profitTarget: limit('percent', '8'),
  minTradingDays: 4,
  consistencyMaxBestDayPercent: null,
  ...over,
})
const trades = (list: [number, number, string][]): MockClosedTrade[] => list.map(([id, exitTime, netPnl]) => ({ id, exitTime, netPnl }))
const run = (input: PropRulesInput, capital: string, closed: MockClosedTrade[], now = NOW) =>
  computeProp({ rules: validatePropRules(1, input), currency: 'USD', initialCapital: capital, closed, openTradeCount: 0, cashFlowCount: 0 }, now)
const today = (...pnls: string[]) =>
  run(p1(), '100000', trades(pnls.map((p, i) => [i + 1, at(2026, 9, 15, 8 + i), p])))

describe('perte du jour (P1 : limite 5 000)', () => {
  it('exactement à la limite : atteinte (égalité = atteinte)', () => {
    const d = today('-3000', '-2000').dailyLoss!
    expect([d.limit, d.loss, d.remaining, d.dayNetPnl, d.used, d.level, d.tradeCount]).toEqual(['5000', '5000', '0', '-5000', 1, 'reached', 2])
    expect(d.referenceBalance).toBe('100000')
  })
  it('un centime sous la limite : critique ; 90 % pile critique ; 89,99… % attention', () => {
    const d = today('-4999.99').dailyLoss!
    expect([d.level, d.remaining]).toEqual(['critical', '0.01'])
    expect(today('-4500').dailyLoss!.level).toBe('critical')
    expect(today('-4499.99').dailyLoss!.level).toBe('warning')
  })
  it('70 % pile : attention ; 69,99 % : ok', () => {
    const d = today('-3500').dailyLoss!
    expect([d.level, d.used, d.remaining]).toEqual(['warning', 0.7, '1500'])
    const e = today('-3499.50').dailyLoss!
    expect(e.level).toBe('ok')
    expect(e.used).toBeCloseTo(0.6999, 12)
  })
  it('les gains du jour compensent les pertes', () => {
    const d = today('-4000', '1500').dailyLoss!
    expect([d.loss, d.remaining, d.level, d.used]).toEqual(['2500', '2500', 'ok', 0.5])
    const w = today('-1000', '3000').dailyLoss!
    expect([w.dayNetPnl, w.loss, w.remaining, w.level]).toEqual(['2000', '0', '5000', 'ok'])
  })
  it('les pertes de la veille ne comptent pas aujourd’hui', () => {
    const s = run(p1(), '100000', trades([[1, at(2026, 9, 14, 21, 59), '-4000'], [2, at(2026, 9, 14, 22, 1), '-1000']]))
    expect([s.dailyLoss!.loss, s.dailyLoss!.tradeCount, s.balance]).toEqual(['1000', 1, '95000'])
  })
  it('solde de début de jour contre capital initial : deux limites différentes', () => {
    const history = trades([[1, at(2026, 9, 10, 10), '20000'], [2, at(2026, 9, 15, 9), '-5500']])
    const initial = run(p1(), '100000', history).dailyLoss!
    expect([initial.limit, initial.level, initial.remaining]).toEqual(['5000', 'reached', '-500'])
    const dayStart = run(p1({ dailyReference: 'dayStartBalance' }), '100000', history).dailyLoss!
    expect([dayStart.referenceBalance, dayStart.limit, dayStart.remaining, dayStart.level]).toEqual(['120000', '6000', '500', 'critical'])
  })
  it('limites en montant et en pourcentage', () => {
    const list = trades([[1, at(2026, 9, 3, 10), '-6000'], [2, at(2026, 9, 15, 9), '-2500']])
    const s = run(p1({ dailyLoss: limit('amount', '2500'), maxLoss: limit('amount', '8000'), profitTarget: limit('amount', '6000.50') }), '100000', list)
    expect([s.dailyLoss!.limit, s.dailyLoss!.level]).toEqual(['2500', 'reached'])
    const m = s.maxLoss!
    expect([m.limit, m.floor, m.remaining, m.level]).toEqual(['8000', '92000', '-500', 'reached'])
    expect(m.used).toBeCloseTo(8500 / 8000, 12)
    const p = run(p1({ dailyLoss: limit('percent', '2.5'), maxLoss: limit('percent', '8') }), '100000', list)
    expect([p.dailyLoss!.limit, p.maxLoss!.limit]).toEqual(['2500', '8000'])
  })
})

describe('perte maximale', () => {
  it('statique : plancher = capital initial − limite', () => {
    const m = run(p1(), '100000', trades([[1, at(2026, 9, 2, 10), '-6000'], [2, at(2026, 9, 15, 9), '-3000']])).maxLoss!
    expect([m.limit, m.floor, m.remaining, m.peak, m.level, m.floorLocked]).toEqual(['10000', '90000', '1000', '100000', 'critical', false])
    expect(m.used).toBeCloseTo(0.9, 12)
    const up = run(p1(), '100000', trades([[1, at(2026, 9, 2, 10), '5000']])).maxLoss!
    expect([up.remaining, up.used, up.level]).toEqual(['15000', 0, 'ok'])
  })
  it('glissante : suit le plus haut solde, avec et sans verrou au capital initial', () => {
    const journal = trades([[1, at(2026, 9, 2, 10), '6000'], [2, at(2026, 9, 3, 10), '8000'], [3, at(2026, 9, 4, 10), '-9000']])
    const m = run(p1({ maxLossKind: 'trailing' }), '100000', journal).maxLoss!
    expect([m.peak, m.floor, m.remaining, m.floorLocked, m.level]).toEqual(['114000', '104000', '1000', false, 'critical'])
    const l = run(p1({ maxLossKind: 'trailing', trailingLocksAtInitial: true }), '100000', journal).maxLoss!
    expect([l.floor, l.remaining, l.floorLocked, l.level, l.used]).toEqual(['100000', '5000', true, 'ok', 0.5])
    const small = trades([[1, at(2026, 9, 2, 10), '4000'], [2, at(2026, 9, 3, 10), '-3000']])
    const s = run(p1({ maxLossKind: 'trailing', trailingLocksAtInitial: true }), '100000', small).maxLoss!
    expect([s.floor, s.remaining, s.floorLocked, s.level]).toEqual(['94000', '7000', false, 'ok'])
  })
  it('plancher glissant touché : atteinte', () => {
    const m = run(p1({ maxLossKind: 'trailing' }), '100000', trades([[1, at(2026, 9, 2, 10), '10000'], [2, at(2026, 9, 3, 10), '-10000']])).maxLoss!
    expect([m.floor, m.remaining, m.level]).toEqual(['100000', '0', 'reached'])
  })
})

describe('objectif, jours de trading, cohérence', () => {
  it('progression de l’objectif', () => {
    const t = run(p1(), '100000', trades([[1, at(2026, 9, 2, 10), '3000'], [2, at(2026, 9, 3, 10), '1000']])).profitTarget!
    expect([t.target, t.gain, t.remaining, t.progress, t.reached]).toEqual(['8000', '4000', '4000', 0.5, false])
    const r = run(p1(), '100000', trades([[1, at(2026, 9, 2, 10), '8000']])).profitTarget!
    expect([r.reached, r.remaining, r.progress]).toEqual([true, '0', 1])
    const l = run(p1(), '100000', trades([[1, at(2026, 9, 2, 10), '-2000']])).profitTarget!
    expect([l.progress, l.remaining, l.reached]).toEqual([-0.25, '10000', false])
  })
  it('jours de trading distincts', () => {
    const s = run(p1(), '100000', trades([[1, at(2026, 9, 2, 8), '10'], [2, at(2026, 9, 2, 15), '-20'], [3, at(2026, 9, 3, 8), '5'], [4, at(2026, 9, 5, 8), '1']]))
    expect(s.tradingDays).toEqual({ count: 3, minimum: 4, missing: 1, done: false })
    expect(run(p1({ minTradingDays: null }), '100000', trades([[1, at(2026, 9, 2, 8), '10']])).tradingDays).toEqual({ count: 1, minimum: null, missing: null, done: null })
    const done = run(p1({ minTradingDays: 1 }), '100000', trades([[1, at(2026, 9, 2, 8), '10'], [2, at(2026, 9, 3, 8), '10']])).tradingDays
    expect([done.missing, done.done]).toEqual([0, true])
  })
  const consistency = (cap: string, list: [number, number, string][]) => run(p1({ consistencyMaxBestDayPercent: cap }), '100000', trades(list)).consistency!
  const journal: [number, number, string][] = [
    [1, at(2026, 9, 2, 8), '3000'],
    [2, at(2026, 9, 3, 8), '2500'],
    [3, at(2026, 9, 3, 9), '-500'],
    [4, at(2026, 9, 4, 8), '1000'],
  ]
  it('cohérence : égalité respectée, dépassement, ok', () => {
    const c = consistency('50', journal)
    expect([c.totalProfit, c.share, c.violated, c.level, c.bestDayAllowed, c.used]).toEqual(['6000', 0.5, false, 'critical', '3000', 1])
    expect([c.bestDay!.day.key, c.bestDay!.netPnl, c.bestDay!.tradeCount]).toEqual(['2026-09-02', '3000', 1])
    expect([consistency('49.99', journal).violated, consistency('49.99', journal).level]).toEqual([true, 'reached'])
    const ok = consistency('80', journal)
    expect([ok.violated, ok.level, ok.used]).toEqual([false, 'ok', 0.625])
  })
  it('cohérence non calculable sans profit total positif', () => {
    const c = consistency('30', [[1, at(2026, 9, 2, 8), '1000'], [2, at(2026, 9, 3, 8), '-2000']])
    expect([c.share, c.violated, c.level, c.bestDayAllowed, c.bestDay!.netPnl]).toEqual([null, null, null, null, '1000'])
    expect(consistency('30', [[1, at(2026, 9, 2, 8), '1000'], [2, at(2026, 9, 3, 8), '-1000']]).share).toBeNull()
    expect(consistency('30', [[1, at(2026, 9, 2, 8), '-1000']]).violated).toBeNull()
  })
  it('un seul jour gagnant = tout le profit ; égalité des meilleurs jours = le plus ancien', () => {
    const c = consistency('30', [[1, at(2026, 9, 2, 8), '1500'], [2, at(2026, 9, 2, 9), '500']])
    expect([c.share, c.violated, c.level]).toEqual([1, true, 'reached'])
    expect(consistency('100', [[1, at(2026, 9, 2, 8), '2000']]).violated).toBe(false)
    expect(consistency('50', [[1, at(2026, 9, 2, 8), '1000'], [2, at(2026, 9, 3, 8), '1000'], [3, at(2026, 9, 4, 8), '500']]).bestDay!.day.key).toBe('2026-09-02')
  })
})

describe('début du défi, journal vide, règles absentes', () => {
  it('trades clôturés avant le début ignorés', () => {
    const s = run(p1(), '100000', trades([[1, at(2026, 8, 31, 21, 59), '-9000'], [2, at(2026, 8, 31, 22), '-1000']]))
    expect([s.startedAt, s.beforeStartCount, s.closedTradeCount, s.balance, s.maxLoss!.remaining]).toEqual([at(2026, 8, 31, 22), 1, 1, '99000', '9000'])
  })
  it('zéro trade', () => {
    const s = run(p1(), '100000', [])
    expect([s.balance, s.netPnl, s.closedTradeCount]).toEqual(['100000', '0', 0])
    const d = s.dailyLoss!
    expect([d.loss, d.remaining, d.used, d.level, d.tradeCount]).toEqual(['0', '5000', 0, 'ok', 0])
    expect([s.maxLoss!.remaining, s.maxLoss!.used, s.maxLoss!.level, s.profitTarget!.progress, s.tradingDays.count]).toEqual(['10000', 0, 'ok', 0, 0])
    expect(s.thresholds).toEqual({ warningPercent: 70, criticalPercent: 90 })
  })
  it('aucune règle = aucun chiffre ; pourcentage d’un capital nul = aucune limite', () => {
    const s = run(
      p1({ dailyLoss: null, maxLoss: null, profitTarget: null, minTradingDays: null, resetTime: '17:00', resetZone: 'newYork' }),
      '100000',
      trades([[1, at(2026, 9, 2, 8), '10']]),
    )
    expect([s.dailyLoss, s.maxLoss, s.profitTarget, s.consistency, s.tradingDays.count]).toEqual([null, null, null, null, 1])
    const z = run(p1(), '0', [])
    expect([z.dailyLoss!.limit, z.dailyLoss!.level, z.maxLoss!.level, z.profitTarget!.progress]).toEqual([null, null, null, null])
  })
})

describe('jour de trading et remise à zéro (Paris et New York, été, hiver, jours de bascule)', () => {
  const dayOf = (zone: 'paris' | 'newYork', reset: string, t: number) => dayKeyOf(tradingDay(zone, parseTime(reset)!, t))
  it('minuit à Paris, été et hiver', () => {
    expect(dayOf('paris', '00:00', at(2026, 7, 14, 21, 59))).toBe('2026-07-14')
    expect(dayOf('paris', '00:00', at(2026, 7, 14, 22, 1))).toBe('2026-07-15')
    expect(dayOf('paris', '00:00', at(2026, 1, 14, 22, 59))).toBe('2026-01-14')
    expect(dayOf('paris', '00:00', at(2026, 1, 14, 23, 1))).toBe('2026-01-15')
  })
  it('Paris les jours de bascule, heure sautée et heure répétée', () => {
    expect(dayOf('paris', '00:00', at(2026, 3, 28, 22, 59))).toBe('2026-03-28')
    expect(dayOf('paris', '00:00', at(2026, 3, 28, 23, 1))).toBe('2026-03-29')
    expect(dayOf('paris', '00:00', at(2026, 3, 29, 21, 59))).toBe('2026-03-29')
    expect(dayOf('paris', '00:00', at(2026, 3, 29, 22, 1))).toBe('2026-03-30')
    expect(dayOf('paris', '00:00', at(2026, 10, 24, 21, 59))).toBe('2026-10-24')
    expect(dayOf('paris', '00:00', at(2026, 10, 24, 22, 1))).toBe('2026-10-25')
    expect(dayOf('paris', '00:00', at(2026, 10, 25, 22, 59))).toBe('2026-10-25')
    expect(dayOf('paris', '00:00', at(2026, 10, 25, 23, 1))).toBe('2026-10-26')
    expect(resetInstant('paris', day(2026, 3, 29), 150)).toBe(at(2026, 3, 29, 1))
    expect(dayOf('paris', '02:30', at(2026, 3, 29, 0, 59))).toBe('2026-03-28')
    expect(dayOf('paris', '02:30', at(2026, 3, 29, 1, 1))).toBe('2026-03-29')
    expect(resetInstant('paris', day(2026, 10, 25), 150)).toBe(at(2026, 10, 25, 0, 30))
  })
  it('17:00 à New York, été et hiver', () => {
    expect(dayOf('newYork', '17:00', at(2026, 7, 15, 20, 59))).toBe('2026-07-14')
    expect(dayOf('newYork', '17:00', at(2026, 7, 15, 21, 1))).toBe('2026-07-15')
    expect(dayOf('newYork', '17:00', at(2026, 1, 15, 21, 59))).toBe('2026-01-14')
    expect(dayOf('newYork', '17:00', at(2026, 1, 15, 22, 1))).toBe('2026-01-15')
    expect(dayOf('newYork', '17:00', at(2026, 7, 15, 5))).toBe('2026-07-14')
  })
  it('New York les jours de bascule', () => {
    expect(dayOf('newYork', '17:00', at(2026, 3, 7, 21, 59))).toBe('2026-03-06')
    expect(dayOf('newYork', '17:00', at(2026, 3, 7, 22, 1))).toBe('2026-03-07')
    expect(dayOf('newYork', '17:00', at(2026, 3, 8, 20, 59))).toBe('2026-03-07')
    expect(dayOf('newYork', '17:00', at(2026, 3, 8, 21, 1))).toBe('2026-03-08')
    expect(dayOf('newYork', '17:00', at(2026, 10, 31, 20, 59))).toBe('2026-10-30')
    expect(dayOf('newYork', '17:00', at(2026, 10, 31, 21, 1))).toBe('2026-10-31')
    expect(dayOf('newYork', '17:00', at(2026, 11, 1, 21, 59))).toBe('2026-10-31')
    expect(dayOf('newYork', '17:00', at(2026, 11, 1, 22, 1))).toBe('2026-11-01')
  })
  it('la perte du jour suit l’heure de remise à zéro', () => {
    const input = p1({ resetTime: '17:00', resetZone: 'newYork', startedOn: '2026-07-01' })
    const list = trades([[1, at(2026, 7, 15, 20, 59), '-4000'], [2, at(2026, 7, 15, 21, 1), '-1000']])
    const s = run(input, '100000', list, at(2026, 7, 15, 21, 30))
    expect([s.dailyLoss!.loss, s.dailyLoss!.tradeCount, s.tradingDay.key, s.tradingDay.startsParisTime]).toEqual(['1000', 1, '2026-07-15', '23:00'])
    expect(run(input, '100000', list.slice(0, 1), at(2026, 7, 15, 21) - MIN).dailyLoss!.loss).toBe('4000')
  })
  it('prochaine remise à zéro en heure de Paris', () => {
    const s = run(p1({ resetTime: '17:00', resetZone: 'newYork' }), '100000', [], at(2026, 7, 15, 18, 48))
    expect(s.nextReset).toEqual({ at: at(2026, 7, 15, 21), inMs: 2 * HOUR + 12 * MIN, parisDay: '2026-07-15', parisTime: '23:00' })
    const w = run(p1(), '100000', [], at(2026, 1, 15, 12))
    expect([w.nextReset.parisDay, w.nextReset.parisTime, w.nextReset.inMs]).toEqual(['2026-01-16', '00:00', 11 * HOUR])
  })
})

describe('validation (mêmes codes que pulse-core)', () => {
  const refused = (over: Partial<PropRulesInput>) => {
    try {
      validatePropRules(1, p1(over))
    } catch (e) {
      return (e as Error).message.replace('invalid input: ', '')
    }
    return 'accepted'
  }
  it('refuse chaque mauvaise valeur avec un code', () => {
    expect(refused({ dailyLoss: limit('percent', '0') })).toBe('prop:percentOutOfRange:dailyLoss')
    expect(refused({ dailyLoss: limit('percent', '100') })).toBe('accepted')
    expect(refused({ maxLoss: limit('percent', '100.01') })).toBe('prop:percentOutOfRange:maxLoss')
    expect(refused({ maxLoss: limit('amount', '-5') })).toBe('prop:amountNotPositive:maxLoss')
    expect(refused({ profitTarget: limit('amount', '0') })).toBe('prop:amountNotPositive:profitTarget')
    expect(refused({ dailyLoss: limit('euros', '5') })).toBe('prop:invalidMode:dailyLoss')
    expect(refused({ dailyLoss: limit('percent', '5,5') })).toBe('prop:invalidNumber:dailyLoss')
    expect(refused({ resetZone: 'london' })).toBe('prop:unknownZone')
    expect(refused({ resetZone: 'Europe/Paris' })).toBe('prop:unknownZone')
    expect(refused({ resetTime: '24:00' })).toBe('prop:invalidResetTime')
    expect(refused({ resetTime: '9:00' })).toBe('prop:invalidResetTime')
    expect(refused({ startedOn: '2026-02-30' })).toBe('prop:invalidStartDay')
    expect(refused({ dailyReference: 'equity' })).toBe('prop:invalidDailyReference')
    expect(refused({ maxLossKind: 'relative' })).toBe('prop:invalidMaxLossKind')
    expect(refused({ minTradingDays: 0 })).toBe('prop:minTradingDaysOutOfRange')
    expect(refused({ consistencyMaxBestDayPercent: '0' })).toBe('prop:percentOutOfRange:consistency')
    expect(refused({ consistencyMaxBestDayPercent: '-10' })).toBe('prop:percentOutOfRange:consistency')
    expect(refused({ consistencyMaxBestDayPercent: '100.5' })).toBe('prop:percentOutOfRange:consistency')
    expect(refused({ phaseLabel: 'x'.repeat(61) })).toBe('prop:phaseLabelTooLong')
    const ok = validatePropRules(1, p1({ consistencyMaxBestDayPercent: '  ', phaseLabel: '  Financé ' }))
    expect([ok.consistencyMaxBestDayPercent, ok.phaseLabel]).toEqual([null, 'Financé'])
  })
})

describe('alertes prop (miroir de alerts/prop.rs)', () => {
  it('niveaux, identités, gravités', () => {
    const s = today('-3000', '-500')
    const alerts = evaluatePropAlerts(s)
    expect(alerts.map((a) => [a.id, a.severity, a.messageKey, a.tradeId, a.at])).toEqual([
      ['propDailyLoss:1:2026-09-01:2026-09-15:warning', 'warning', 'propDailyLoss.warning', 2, at(2026, 9, 15, 9)],
    ])
    const a = alerts[0]
    expect(a.kind === 'propDailyLoss' && [a.remaining, a.limit, a.used, a.tradingDay, a.nextResetParisTime, a.phaseLabel]).toEqual([
      '1500', '5000', 0.7, '2026-09-15', '00:00', 'Évaluation 1',
    ])
    expect(evaluatePropAlerts(today('-3000'))).toEqual([])
    expect(evaluatePropAlerts(today('-4600')).map((x) => [x.severity, x.messageKey])).toEqual([['critical', 'propDailyLoss.critical']])
    expect(evaluatePropAlerts(today('-5000')).map((x) => x.messageKey)).toEqual(['propDailyLoss.reached'])
  })
  it('perte maximale et cohérence', () => {
    const s = run(p1({ dailyLoss: null, consistencyMaxBestDayPercent: '40' }), '100000', trades([[1, at(2026, 9, 2, 8), '3000'], [2, at(2026, 9, 3, 8), '1000']]))
    expect(evaluatePropAlerts(s).map((a) => a.id)).toEqual(['propConsistency:1:2026-09-01:reached'])
    const t = run(
      p1({ dailyLoss: null, consistencyMaxBestDayPercent: '40' }),
      '100000',
      trades([[1, at(2026, 9, 2, 8), '3000'], [2, at(2026, 9, 3, 8), '1000'], [3, at(2026, 9, 4, 8), '-11000']]),
    )
    expect(evaluatePropAlerts(t).map((a) => [a.id, a.severity])).toEqual([['propMaxLoss:1:2026-09-01:warning', 'warning']])
  })
  it('une amélioration n’est jamais une nouvelle alerte', () => {
    const alerts = evaluatePropAlerts(today('-3600'))
    const scope = 'propDailyLoss:1:2026-09-01:2026-09-15'
    expect(dropImprovements(alerts, [`${scope}:critical`])).toEqual([])
    expect(dropImprovements(alerts, [`${scope}:warning`])).toHaveLength(1)
    expect(dropImprovements(alerts, ['propDailyLoss:1:2026-09-01:2026-09-14:reached'])).toHaveLength(1)
  })
  it('magasin simulé : compte prop seulement, sans règles = rien, réglage éteint = rien', async () => {
    const accounts: Account[] = [
      { id: 1, name: 'Défi', kind: 'prop', broker: '', currency: 'USD', initialCapital: '100000', archived: false, hasHistory: true },
      { id: 2, name: 'Perso', kind: 'personal', broker: '', currency: 'USD', initialCapital: '5000', archived: false, hasHistory: false },
    ]
    const m = createPropMock({
      accounts: () => accounts,
      closed: () => trades([[1, at(2026, 9, 15, 8), '-9000']]),
      openCount: () => 1,
      cashFlowCount: () => 0,
      now: () => NOW,
    })
    await expect(m.setPropRules(2, p1())).rejects.toThrow('prop:notProp')
    await expect(m.getPropStatus(2)).rejects.toThrow('prop:notProp')
    expect(await m.getPropStatus(1)).toBeNull()
    expect(m.alertsFor(accounts[0], NOW, [])).toEqual([])
    await expect(m.setPropRules(1, p1({ resetZone: 'tokyo' }))).rejects.toThrow('prop:unknownZone')
    await m.setPropRules(1, p1())
    const s = (await m.getPropStatus(1))!
    expect([s.openTradeCount, s.balance, s.alertsEnabled]).toEqual([1, '91000', true])
    expect(m.alertsFor(accounts[0], NOW, []).map((a) => a.kind)).toEqual(['propDailyLoss', 'propMaxLoss'])
    await m.setPropAlerts(false)
    expect(m.alertsFor(accounts[0], NOW, [])).toEqual([])
    expect((await m.getPropStatus(1))!.alertsEnabled).toBe(false)
    await m.deletePropRules(1)
    expect(await m.getPropRules(1)).toBeNull()
  })
})
