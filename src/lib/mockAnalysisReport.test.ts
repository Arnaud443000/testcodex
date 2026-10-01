// Constat « est-ce que j'analyse bien ? » du faux backend : mêmes journaux que `analysis::tests` (Rust).
// Long, entrée 100, stop 90 (risque 10), taille 1, multiplicateur 1 : R = (sortie − 100) / 10.
// Un trade avec stop, sans plan ni règle, a un score de discipline de 100 ; sans stop : 10 / 20 = 50.
import { describe, expect, it } from 'vitest'

import type { TradeData } from '../types/trade'
import { mock, mockAnalysis } from './mockBackend'

const DAY = 86_400_000
const HOUR = 3_600_000
const MON = 20_724 * DAY
let instrumentId = 0

async function journal(exits: { exit: string; stop: boolean }[]) {
  const account = (await mock.createAccount({ name: `J${Math.random()}`, kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
  instrumentId = (await mock.listInstruments())[0].id
  const ids: number[] = []
  for (const [i, t] of exits.entries()) {
    const trade: TradeData = {
      accountId: account, instrumentId, direction: 'long', size: '1', multiplier: '1', entryPrice: '100', exitPrice: t.exit,
      entryTime: MON + (i + 1) * DAY + 9 * HOUR, exitTime: MON + (i + 1) * DAY + 10 * HOUR, tzOffsetMin: 0,
      plannedSl: t.stop ? '90' : null, fees: '0', thesis: '', postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [],
    }
    ids.push((await mock.createTrade(trade)).id)
  }
  return { account, ids }
}

async function compare(exits: { exit: string; stop: boolean }[], linkedCount: number) {
  const { account, ids } = await journal(exits)
  const idea = (await mockAnalysis.createIdea({ instrumentId, timeframes: [], note: 'Idée', levelLow: null, levelHigh: null, invalidation: null })).id
  for (const id of ids.slice(0, linkedCount)) await mockAnalysis.setTradeLinks(id, [idea], [])
  return (await mockAnalysis.getAnalysisReport({ accountIds: [account] })).comparison
}

const five = (exit: string, stop = true) => Array.from({ length: 5 }, () => ({ exit, stop }))

describe('constat du faux backend : trades liés et non liés', () => {
  it('écart de 0,25 R exactement = « plus haut » ; juste en dessous = « similaire » ; −0,25 = « plus bas »', async () => {
    const c = await compare([...five('105'), ...five('102.5')], 5)
    expect([c.linked.tradeCount, c.unlinked.tradeCount]).toEqual([5, 5])
    expect([c.linked.expectancyR, c.unlinked.expectancyR]).toEqual([0.5, 0.25])
    expect([c.expectancyR.verdict, c.expectancyR.difference]).toEqual(['higher', 0.25])
    expect([c.linked.disciplineScore, c.unlinked.disciplineScore]).toEqual([100, 100])
    expect([c.discipline.verdict, c.discipline.difference]).toEqual(['similar', 0])
    expect((await compare([...five('105'), ...five('102.6')], 5)).expectancyR.verdict).toBe('similar')
    const low = await compare([...five('105'), ...five('107.5')], 5)
    expect([low.expectancyR.verdict, low.expectancyR.difference]).toEqual(['lower', -0.25])
  })

  it('écart de discipline de 10 points exactement = « plus haut »', async () => {
    const c = await compare([...five('105'), ...Array.from({ length: 4 }, () => ({ exit: '105', stop: true })), { exit: '105', stop: false }], 5)
    expect([c.linked.disciplineScore, c.unlinked.disciplineScore]).toEqual([100, 90])
    expect([c.discipline.verdict, c.discipline.difference]).toEqual(['higher', 10])
    expect([c.unlinked.rTradeCount, c.expectancyR.verdict]).toEqual([4, 'notEnoughData'])
  })

  it('pas de comparaison sous 5 trades par côté ; aucun lien = rien de comparable', async () => {
    const c = await compare([...five('105'), ...five('102.5')], 4)
    expect([c.linked.tradeCount, c.unlinked.tradeCount]).toEqual([4, 6])
    expect([c.discipline.verdict, c.expectancyR.verdict]).toEqual(['notEnoughData', 'notEnoughData'])
    expect([c.discipline.difference, c.expectancyR.difference, c.linked.disciplineScore]).toEqual([null, null, null])
    const none = await compare([...five('105'), ...five('102.5')], 0)
    expect([none.linked.tradeCount, none.expectancyR.verdict, none.linked.expectancyR]).toEqual([0, 'notEnoughData', null])
  })
})
