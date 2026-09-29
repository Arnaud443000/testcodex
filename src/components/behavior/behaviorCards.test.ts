import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { DisciplineReport, MistakeReport, StreakReport } from '../../types/behavior'
import type { Heatmap, RDistribution, RiskReport } from '../../types/stats'
import { DayBars } from './DayBars'
import { DisciplineCard } from './DisciplineCard'
import { QuadrantsGrid } from './ScoreRing'
import { MistakesCard } from './MistakesCard'
import { StreaksCard } from './StreaksCard'
import { HeatmapCard, RDistributionCard, RiskCard } from './StatsCards'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(createElement(MemoryRouter, null, el))
const zero = { count: 0, netPnl: '0' }

const tooSmall: DisciplineReport = {
  score: null, scoredTradeCount: 3, minTradeCount: 5, sampleTooSmall: true,
  components: [
    { key: 'plan', weight: 30, tradeCount: 0, average: null },
    { key: 'risk', weight: 10, tradeCount: 0, average: null },
  ],
  days: [],
  quadrants: { threshold: 70, wellExecutedWins: zero, poorlyExecutedWins: zero, wellExecutedLosses: zero, poorlyExecutedLosses: zero, breakevens: zero },
  trades: [],
  settings: { maxRiskPercent: null, maxTradesPerDay: null, revengeWindowMin: 60, revengeSizeFactor: '1.5' },
}

describe('états vides de la page Comportement', () => {
  it('score non établi : « — » et message clair, jamais 0', () => {
    const out = html(createElement(DisciplineCard, { report: tooSmall }))
    expect(out).toContain('Pas assez de trades')
    expect(out).toContain('au moins 5 trades clôturés ; vous en avez 3')
    expect(out).toContain('Score de discipline non établi')
    expect(out).not.toContain('stroke-dasharray') // pas d'arc dessiné
    expect(out).not.toMatch(/>0</)
    expect(out).toContain('Aucune limite de risque')
  })

  it('score établi : la valeur arrondie et son libellé accessible', () => {
    const out = html(createElement(DisciplineCard, { report: { ...tooSmall, score: 77.6, sampleTooSmall: false, scoredTradeCount: 12 } }))
    expect(out).toContain('>78<')
    expect(out).toContain('Score de discipline : 78 sur 100')
  })

  it('séries : aucune série en cours', () => {
    const report: StreakReport = { current: null, longestWin: null, longestLoss: null, tradeCount: 0 }
    const out = html(createElement(StreaksCard, { report, currency: 'USD' }))
    expect(out).toContain('Aucune (dernier trade à plat)')
  })

  it('erreurs : message clair sans ligne', () => {
    const report: MistakeReport = { tradeCount: 10, tradesWithMistake: 0, byCount: [], byCost: [] }
    expect(html(createElement(MistakesCard, { report, currency: 'USD' }))).toContain('Aucune erreur enregistrée')
  })

  it('erreurs : coût affiché comme une perte signée, règle préfixée', () => {
    const report: MistakeReport = {
      tradeCount: 10, tradesWithMistake: 2,
      byCount: [], byCost: [{ source: 'rule', id: 1, label: 'Stop posé', tradeCount: 2, share: 0.2, netPnl: '-50', cost: '50', expectancyR: null, tradeIds: [1, 2] }],
    }
    const out = html(createElement(MistakesCard, { report, currency: 'USD' }))
    expect(out).toContain('−50,00')
    expect(out).toContain('Règle non respectée : Stop posé')
    expect(out).toContain('Sur 10 trades, 2 portent au moins une erreur')
  })

  it('R sans stop loss : message, pas de barre', () => {
    const report: RDistribution = { binWidth: 0.5, bins: [], rTradeCount: 0, noRCount: 4, meanR: null, medianR: null }
    const out = html(createElement(RDistributionCard, { report }))
    expect(out).toContain('Aucun trade avec un stop loss prévu')
    expect(out).toContain('4 trades sans stop loss prévu')
  })

  it('heatmap vide et risque non calculable', () => {
    const heat: Heatmap = { cells: [], maxAbsNetPnl: '0' }
    expect(html(createElement(HeatmapCard, { report: heat, currency: 'USD' }))).toContain('Aucun trade clôturé à afficher')
    const risk: RiskReport = {
      trades: [], tradeCount: 3, withoutStopCount: 3, avgRiskPct: null, medianRiskPct: null, maxRiskPct: null,
      maxRiskPercent: null, overLimitCount: null, currentCapital: '1000', limitAmount: null,
    }
    const out = html(createElement(RiskCard, { report: risk, currency: 'USD' }))
    expect(out).toContain('le risque ne peut pas être calculé')
    expect(out).toContain('Aucune limite de risque')
    expect(out).not.toContain('0,00')
  })

  it('heatmap : le signe est écrit dans la case', () => {
    const heat: Heatmap = {
      maxAbsNetPnl: '100',
      cells: [
        { weekday: 1, hour: 9, tradeCount: 2, winCount: 0, netPnl: '-100', winRate: 0, intensity: -1 },
        { weekday: 2, hour: 10, tradeCount: 1, winCount: 1, netPnl: '40', winRate: 1, intensity: 0.4 },
      ],
    }
    const out = html(createElement(HeatmapCard, { report: heat, currency: 'USD' }))
    expect(out).toContain('−100')
    expect(out).toContain('+40')
    expect(out).toContain('cal-l3')
    expect(out).toContain('cal-g2')
  })
})

describe('page Discipline', () => {
  it('le résumé du score renvoie vers la page Discipline', () => {
    expect(html(createElement(DisciplineCard, { report: tooSmall }))).toContain('href="/discipline"')
  })

  it('score par jour : une barre par jour, jour sans score en « sans score », seuil affiché', () => {
    const days = [
      { day: '2026-09-28', tradeCount: 2, score: 82.4 },
      { day: '2026-09-29', tradeCount: 1, score: null },
    ]
    const out = html(createElement(DayBars, { days, threshold: 70, selected: '2026-09-28', onSelect: () => undefined }))
    expect(out).toContain('2026-09-28 : score 82 sur 100, 2 trades')
    expect(out).toContain('2026-09-29 : sans score, 1 trade')
    expect(out).toContain('aria-pressed="true"')
    expect(out).toContain('Seuil « bien exécuté » : 70')
    expect(out).toContain('height:82.4%')
    expect(out).toContain('height:3px')
  })

  it('les quatre cases affichent nombre et P&L signé, « 0,00 » sans signe quand elles sont vides', () => {
    const out = html(
      createElement(QuadrantsGrid, {
        currency: 'USD',
        quadrants: { ...tooSmall.quadrants, wellExecutedWins: { count: 3, netPnl: '120.5' }, poorlyExecutedLosses: { count: 2, netPnl: '-80' } },
      }),
    )
    expect(out).toContain('Gagnants bien exécutés')
    expect(out).toContain('+120,50')
    expect(out).toContain('−80,00')
    expect(out).toContain('Bien exécuté = score de 70 ou plus.')
  })
})
