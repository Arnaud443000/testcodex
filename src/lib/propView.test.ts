import { describe, expect, it } from 'vitest'
import { fr } from '../i18n/fr'
import { alertMessage } from './alertFormat'
import { computeProp, evaluatePropAlerts, validatePropRules } from './mockProp'
import { widgetPropAccount } from './propView'
import { formatCountdown, formatDayKey, formatUsedPercent, gaugeWidth, levelIcon, levelLabel, levelTone, parsePropError, propErrorText } from './propView'

const NBSP = ' '

describe('affichage du suivi prop firm (lot 33)', () => {
  it('part utilisée tronquée au dixième, jamais arrondie vers le haut', () => {
    expect(formatUsedPercent(0.7)).toBe(`70,0${NBSP}%`)
    expect(formatUsedPercent(0.9)).toBe(`90,0${NBSP}%`)
    expect(formatUsedPercent(0.999998)).toBe(`99,9${NBSP}%`)
    expect(formatUsedPercent(0.6999)).toBe(`69,9${NBSP}%`)
    expect(formatUsedPercent(1)).toBe(`100,0${NBSP}%`)
    expect(formatUsedPercent(1.0625)).toBe(`106,2${NBSP}%`)
    expect(formatUsedPercent(0)).toBe(`0,0${NBSP}%`)
    expect(formatUsedPercent(-0.25)).toBe(`−25,0${NBSP}%`)
    expect(formatUsedPercent(null)).toBe('—')
  })
  it('barre de jauge bornée à [0 ; 100]', () => {
    expect([gaugeWidth(0.7), gaugeWidth(1.2), gaugeWidth(-0.3), gaugeWidth(null)]).toEqual([70, 100, 0, 0])
  })
  it('compte à rebours avant la remise à zéro', () => {
    expect(formatCountdown((3 * 60 + 12) * 60_000)).toBe(`3${NBSP}h${NBSP}12${NBSP}min`)
    expect(formatCountdown(45 * 60_000 + 59_000)).toBe(`45${NBSP}min`)
    expect(formatCountdown(2 * 3_600_000)).toBe(`2${NBSP}h`)
    expect(formatCountdown(30_000)).toBe(`<${NBSP}1${NBSP}min`)
    expect(formatCountdown(-5)).toBe(`<${NBSP}1${NBSP}min`)
  })
  it('jour, niveau en texte, ton et icône (jamais la couleur seule)', () => {
    expect(formatDayKey('2026-09-15')).toBe('15/09/2026')
    expect(levelLabel(fr, 'warning')).toBe('À surveiller')
    expect(levelLabel(fr, 'reached')).toBe('Limite atteinte')
    expect(levelLabel(fr, 'reached', true)).toBe('Règle dépassée')
    expect(levelLabel(fr, null)).toBe('Non calculable')
    expect([levelTone('ok'), levelTone('warning'), levelTone('critical'), levelTone('reached'), levelTone(null)]).toEqual(['ok', 'warn', 'bad', 'bad', 'neutral'])
    expect([levelIcon('ok'), levelIcon('critical'), levelIcon(null)]).toEqual(['check', 'alert', 'info'])
  })
  it('refus de pulse-core traduits, avec le champ', () => {
    expect(parsePropError(new Error('invalid input: prop:percentOutOfRange:maxLoss'))).toEqual({ code: 'percentOutOfRange', field: 'maxLoss' })
    expect(propErrorText(fr, new Error('invalid input: prop:percentOutOfRange:maxLoss'))).toBe(
      'Un pourcentage doit être supérieur à 0 et au plus 100. (perte maximale)',
    )
    expect(propErrorText(fr, 'invalid input: prop:unknownZone')).toMatch(/Paris et New York/)
    expect(propErrorText(fr, new Error('database error: disk full'))).toBe('database error: disk full')
  })
})

describe('texte des alertes prop (constat, jamais un ordre)', () => {
  it('perte du jour à surveiller, avec la phase, le reste et la remise à zéro en heure de Paris', () => {
    const rules = validatePropRules(1, {
      phaseLabel: 'Évaluation 1', startedOn: '2026-09-01', dailyLoss: { mode: 'percent', value: '5' }, dailyReference: 'initialBalance',
      maxLoss: null, maxLossKind: 'static', trailingLocksAtInitial: false, resetTime: '00:00', resetZone: 'paris',
      profitTarget: null, minTradingDays: null, consistencyMaxBestDayPercent: null,
    })
    const s = computeProp(
      { rules, currency: 'USD', initialCapital: '100000', closed: [{ id: 1, exitTime: Date.UTC(2026, 8, 15, 8), netPnl: '-3500' }], openTradeCount: 0, cashFlowCount: 0 },
      Date.UTC(2026, 8, 15, 15),
    )
    const text = alertMessage(fr, evaluatePropAlerts(s)[0])
    expect(text).toContain('Prop firm (Évaluation 1)')
    expect(text).toContain(`70,0${NBSP}%`)
    expect(text).toContain('À surveiller')
    expect(text).toContain('reste 1')
    expect(text).toContain('00:00, heure de Paris')
    expect(text).toContain('trades clôturés seulement')
    expect(text).not.toMatch(/ne tradez pas|arrêtez/i)
  })
})

describe('compte lu par le widget Prop firm', () => {
  it('le seul compte prop de la portée, jamais deviné parmi plusieurs', () => {
    expect(widgetPropAccount([{ id: 3, kind: 'prop' }])).toBe(3)
    expect(widgetPropAccount([{ id: 1, kind: 'personal' }, { id: 3, kind: 'prop' }])).toBe(3)
    expect(widgetPropAccount([{ id: 1, kind: 'personal' }])).toBe('notProp')
    expect(widgetPropAccount([{ id: 3, kind: 'prop' }, { id: 4, kind: 'prop' }])).toBe('none')
    expect(widgetPropAccount([])).toBe('none')
  })
})
