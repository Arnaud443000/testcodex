import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { AfterLossesReport, ExternalFactorReport, FactorReport, FactorSide, PlanSimulation, SequenceGroup, SizeChangeGroup, SizeChangeReport, SimulatedResult } from '../../types/behavior'
import type { Summary } from '../../types/stats'
import { formatMoneyGap, formatRGap, formatScoreGap, formatSizeChange } from '../../lib/behaviorFormat'
import { FactorsCard } from './FactorsCard'
import { PlanCard } from './PlanCard'
import { StreaksCard } from './StreaksCard'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(createElement(MemoryRouter, null, el))

const summary = (over: Partial<Summary> = {}): Summary => ({ tradeCount: 0, netPnl: '0', winRate: null, expectancyR: null, rTradeCount: 0, avgNetPnl: null, ...over }) as Summary
const group = (over: Partial<SequenceGroup> = {}): SequenceGroup => ({ summary: summary(), disciplineScore: null, scoredTradeCount: 0, tradeIds: [], ...over })
const streaks = { tradeCount: 3, current: null, longestWin: null, longestLoss: null } as never

const afterLosses = (over: Partial<AfterLossesReport> = {}): AfterLossesReport => ({
  afterTwoLosses: group(), others: group(), minTradeCount: 5, sampleTooSmall: true,
  winRateDifference: null, avgNetPnlDifference: null, expectancyRDifference: null, disciplineDifference: null, ...over,
})
const sizeGroup = (over: Partial<SizeChangeGroup> = {}): SizeChangeGroup => ({ previousOutcome: 'loss', caseCount: 0, notComparableCount: 0, increasedCount: 0, meanChange: null, medianChange: null, cases: [], ...over })
const size = (over: Partial<SizeChangeReport> = {}): SizeChangeReport => ({
  afterLoss: sizeGroup(), afterWin: sizeGroup({ previousOutcome: 'win' }), afterBreakeven: sizeGroup({ previousOutcome: 'breakeven' }),
  noPreviousCount: 0, tradeCount: 0, minCaseCount: 5, lossVsWin: null, ...over,
})

describe('formats des compléments', () => {
  it('« — » quand la valeur manque, vrai signe moins sinon', () => {
    expect(formatSizeChange(null)).toBe('—')
    expect(formatSizeChange(0.23)).toBe('+23 %')
    expect(formatSizeChange(-0.1)).toBe('−10 %')
    expect(formatScoreGap(null)).toBe('—')
    expect(formatScoreGap(-14.2)).toBe('−14 pts')
    expect(formatScoreGap(1)).toBe('+1 pt')
    expect(formatRGap(null)).toBe('—')
    expect(formatRGap(-0.42)).toBe('−0,42 R')
    expect(formatMoneyGap(null, 'USD')).toBe('—')
    expect(formatMoneyGap('-1730', 'USD')).toContain('−')
  })
})

describe('Séries : après 2 pertes et taille après une perte', () => {
  it('échantillon trop petit : « — » et message, jamais 0', () => {
    const out = html(createElement(StreaksCard, { report: streaks, currency: 'USD', afterLosses: afterLosses({ afterTwoLosses: group({ summary: summary({ tradeCount: 2 }) }) }), sizeChange: size({ afterLoss: sizeGroup({ caseCount: 3 }) }) }))
    expect(out).toContain('Moyenne après 2 pertes')
    expect(out).toContain('Échantillon trop petit : 2 sur 5 minimum.')
    expect(out).toContain('Échantillon trop petit : 3 sur 5 minimum.')
    expect(out).not.toMatch(/>0[,.]?0*\s?R</)
  })
  it('aucun trade après deux pertes', () => {
    expect(html(createElement(StreaksCard, { report: streaks, currency: 'USD', afterLosses: afterLosses(), sizeChange: size() }))).toContain('Aucun trade après deux pertes de suite.')
  })
  it('valeurs établies, comparées aux autres trades', () => {
    const out = html(createElement(StreaksCard, {
      report: streaks, currency: 'USD',
      afterLosses: afterLosses({ sampleTooSmall: false, afterTwoLosses: group({ summary: summary({ tradeCount: 6, expectancyR: -0.4, rTradeCount: 6 }) }), others: group({ summary: summary({ tradeCount: 20, expectancyR: 0.35, rTradeCount: 20 }) }) }),
      sizeChange: size({ afterLoss: sizeGroup({ caseCount: 8, meanChange: 0.23, medianChange: 0.2 }), afterWin: sizeGroup({ previousOutcome: 'win', caseCount: 9, meanChange: 0.05 }) }),
    }))
    expect(out).toContain('−0,40')
    expect(out).toContain('autres trades : +0,35')
    expect(out).toContain('+23')
    expect(out).toContain('médiane +20')
    expect(out).toContain('après un gain : +5')
    expect(out).toContain('n’affirme pas que les pertes causent')
  })
})

const result = (over: Partial<SimulatedResult> = {}): SimulatedResult => ({ tradeCount: 10, netPnl: '500', winRate: 0.5, expectancyR: 0.2, rTradeCount: 10, profitFactor: 1.4, totalGains: '900', totalLosses: '400', maxDrawdown: '250', ...over })
const scenario = (over: object = {}) => ({ excludedTradeCount: 0, excludedNetPnl: '0', result: result(), difference: null, excludedTradeIds: [], ...over })
const sim = (over: Partial<PlanSimulation> = {}): PlanSimulation => ({ declaredTradeCount: 0, actual: result(), withoutOffPlan: scenario(), withoutOffPlanOrPartial: scenario(), ...over }) as PlanSimulation

describe('Simulation du plan', () => {
  it('toujours étiquetée « Simulation », avec l’avertissement', () => {
    const out = html(createElement(PlanCard, { report: { groups: [] } as never, currency: 'USD', simulation: sim({ declaredTradeCount: 8, withoutOffPlan: scenario({ excludedTradeCount: 3, difference: '1730', excludedNetPnl: '-1730', result: result({ netPnl: '2230' }) }) }) }))
    expect(out).toContain('Simulation')
    expect(out).toContain('supérieur d’environ')
    expect(out).toContain('ni une prévision ni un conseil')
    expect(out).toContain('3 retirés')
  })
  it('aucun plan renseigné : message clair, pas de tableau', () => {
    const out = html(createElement(PlanCard, { report: { groups: [] } as never, currency: 'USD', simulation: sim() }))
    expect(out).toContain('Simulation impossible')
    expect(out).not.toContain('<table')
  })
  it('trades hors plan gagnants : formulation inverse', () => {
    const out = html(createElement(PlanCard, { report: { groups: [] } as never, currency: 'USD', simulation: sim({ withoutOffPlan: scenario({ excludedTradeCount: 1, difference: '-300' }) }) }))
    expect(out).toContain('a en réalité rapporté')
    expect(out).toContain('−')
  })
})

const side = (days: number, disc: number | null, r: number | null): FactorSide => ({ dayCount: days, summary: summary({ tradeCount: days, expectancyR: r, rTradeCount: days }), disciplineScore: disc, scoredTradeCount: days, tradeIds: [] })
const cmp = (present: number | null, absent: number | null, difference: number | null, verdict: 'notEnoughData' | 'lower' | 'similar' | 'higher') => ({ present, absent, difference, verdict })
const factor = (key: FactorReport['key'], over: Partial<FactorReport> = {}): FactorReport => ({
  key, present: side(0, null, null), absent: side(0, null, null), undeclaredDayCount: 0, undeclaredTradeCount: 0,
  discipline: cmp(null, null, null, 'notEnoughData'), expectancyR: cmp(null, null, null, 'notEnoughData'), avgNetPnlDifference: null, ...over,
})
const report = (factors: FactorReport[], over: Partial<ExternalFactorReport> = {}): ExternalFactorReport => ({ factors, tradeCount: 20, tradingDayCount: 20, journalDayCount: 12, minDayCount: 5, minRTradeCount: 5, ...over })

describe('Facteurs externes', () => {
  it('sans journal : état vide avec lien vers le Journal', () => {
    const out = html(createElement(FactorsCard, { report: report([], { journalDayCount: 0 }), currency: 'USD' }))
    expect(out).toContain('Pas encore de journal')
    expect(out).toContain('href="/journal"')
  })
  it('échantillon trop petit : message clair, aucun verdict ni chiffre inventé', () => {
    const out = html(createElement(FactorsCard, { report: report([factor('poorSleep', { present: side(2, null, null), absent: side(9, 70, 0.3) })]), currency: 'USD' }))
    expect(out).toContain('Échantillon trop petit pour conclure')
    expect(out).toContain('vous en avez 2 et 9')
    expect(out).not.toContain('était plus')
  })
  it('verdict prudent : « en même temps », jamais « parce que »', () => {
    const f = factor('poorSleep', {
      present: side(6, 60, -0.2), absent: side(8, 78, 0.3),
      discipline: cmp(60, 78, -18, 'lower'), expectancyR: cmp(-0.2, 0.3, -0.5, 'lower'), avgNetPnlDifference: '-42.5',
    })
    const out = html(createElement(FactorsCard, { report: report([f]), currency: 'USD' }))
    expect(out).toContain('Les jours de mauvais sommeil, votre score de discipline était plus bas (−18')
    expect(out).toContain('votre espérance en R était plus bas (−0,50')
    expect(out).toContain('ne prouvent pas que le facteur en est la cause')
    expect(out).not.toMatch(/parce que|à cause/i)
  })
  it('discipline sans note d’un côté : « — » et explication, pas de 0', () => {
    const f = factor('lowMood', { present: side(6, null, 0.1), absent: side(8, 70, 0.3), expectancyR: cmp(0.1, 0.3, null, 'notEnoughData') })
    const out = html(createElement(FactorsCard, { report: report([f]), currency: 'USD' }))
    expect(out).toContain('Pas assez de trades notés')
    expect(out).toContain('Avec —')
  })
})
