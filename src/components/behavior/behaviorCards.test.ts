import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { DisciplineReport, MistakeReport, StreakReport } from '../../types/behavior'
import type { Heatmap, RDistribution, RiskReport } from '../../types/stats'
import type { PatternReport, RuleAdherenceReport } from '../../types/behavior'
import { DayBars } from './DayBars'
import { HesitationCard } from './HesitationCard'
import { RulesCard } from './RulesCard'
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
    expect(out).toContain('href="/trades?mistake=rule:1"')
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

describe('respect des règles et hésitation', () => {
  const rules: RuleAdherenceReport = {
    checks: 10, respected: 7, rate: 0.7, tradesWithChecks: 5,
    rules: [
      { ruleId: 1, text: 'Toujours poser un stop', archived: false, checks: 6, respected: 5, rate: 5 / 6, trend: 0.25, monthly: [{ month: '2026-08', checks: 2, respected: 1, rate: 0.5 }, { month: '2026-09', checks: 4, respected: 4, rate: 1 }] },
      { ruleId: 2, text: 'Pas de trade après 2 pertes', archived: false, checks: 4, respected: 2, rate: 0.5, trend: -0.5, monthly: [] },
      { ruleId: 3, text: 'Jamais cochée', archived: false, checks: 0, respected: 0, rate: null, trend: null, monthly: [] },
    ],
  }

  it('règles : taux, tendance signée avec son sens écrit, série par mois', () => {
    const out = html(createElement(RulesCard, { report: rules }))
    expect(out).toContain('Toujours poser un stop')
    expect(out).toContain('▲ +25')
    expect(out).toContain('▼ −50')
    expect(out).toContain('Jamais cochée')
    expect(out).toContain('Jamais cochée sur cette période')
    expect(out).toContain('août 2026')
    expect(out).toContain('sept. 2026 : 100')
    expect(out).toContain('height:100%')
    expect(out).toContain('7 respects sur 10 coches, sur 5 trades')
  })

  it('règles : rien de coché → message et lien vers les réglages, pas de 0 %', () => {
    const out = html(createElement(RulesCard, { report: { checks: 0, respected: 0, rate: null, tradesWithChecks: 0, rules: [] } }))
    expect(out).toContain('Aucune règle n’a été cochée')
    expect(out).toContain('href="/settings"')
    expect(out).not.toContain('0 %')
  })

  const patterns = (over: Partial<PatternReport>): PatternReport => ({
    revengeTrades: [], revengeSummary: {} as PatternReport['revengeSummary'], maxTradesPerDay: null, overtradingDays: [], hesitation: [], missedTradeCount: 0, ...over,
  })

  it('hésitation : pris contre manqués par setup, part manquée', () => {
    const out = html(
      createElement(HesitationCard, {
        report: patterns({
          missedTradeCount: 3,
          hesitation: [
            { tagId: 1, kind: 'setup', name: 'Breakout NY', taken: 6, missed: 2, missedShare: 0.25 },
            { tagId: 2, kind: 'session', name: 'Londres', taken: 4, missed: 1, missedShare: 0.2 },
          ],
        }),
      }),
    )
    expect(out).toContain('Breakout NY')
    expect(out).toContain('6 pris · 2 manqués')
    expect(out).toContain('25\u00a0% manqués')
    expect(out).not.toContain('Londres') // la vue par défaut est « Setup »
    expect(out).toContain('3 trades manqués sur la période.')
  })

  it('hésitation : aucun trade manqué → message clair', () => {
    expect(html(createElement(HesitationCard, { report: patterns({}) }))).toContain('Aucun trade manqué enregistré')
  })
})
