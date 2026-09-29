import { describe, expect, it } from 'vitest'
import type { Rule, TradeView } from '../types/trade'
import { brokenRuleTexts, isSingleTradeAlert } from './alertRules'

const rule = (id: number, text: string, position = id): Rule => ({ id, text, archived: false, position })
const rules = new Map([rule(1, 'Toujours poser un stop loss'), rule(2, 'Pas de trade après 20 h'), { ...rule(3, 'Ancienne règle'), archived: true }].map((r) => [r.id, r]))
const trade = (id: number, checks: [number, boolean][]) => ({ id, ruleChecks: checks.map(([ruleId, respected]) => ({ ruleId, respected })) }) as TradeView
const trades = new Map([
  trade(10, [[1, false], [2, true]]),
  trade(11, [[2, true]]),
  trade(12, [[3, false], [2, false]]),
  trade(13, []),
].map((t) => [t.id, t]))

describe('lien alerte ↔ règles personnelles', () => {
  it('montre les règles notées non respectées sur le trade visé', () => {
    expect(brokenRuleTexts({ kind: 'noStopLoss', tradeId: 10 }, trades, rules)).toEqual(['Toujours poser un stop loss'])
  })
  it('ne montre rien quand toutes les règles sont respectées, absentes ou le trade inconnu', () => {
    expect(brokenRuleTexts({ kind: 'revenge', tradeId: 11 }, trades, rules)).toEqual([])
    expect(brokenRuleTexts({ kind: 'revenge', tradeId: 13 }, trades, rules)).toEqual([])
    expect(brokenRuleTexts({ kind: 'revenge', tradeId: 999 }, trades, rules)).toEqual([])
  })
  it('garde les règles archivées et suit l’ordre des règles', () => {
    expect(brokenRuleTexts({ kind: 'outsideHours', tradeId: 12 }, trades, rules)).toEqual(['Pas de trade après 20 h', 'Ancienne règle'])
  })
  it('n’invente rien pour les alertes qui portent sur un ensemble de trades ou sans trade', () => {
    for (const kind of ['consecutiveLosses', 'tradesPerDay', 'tradesPerWindow', 'dailyLoss', 'weeklyLoss'] as const) {
      expect(brokenRuleTexts({ kind, tradeId: 10 }, trades, rules)).toEqual([])
    }
    expect(brokenRuleTexts({ kind: 'noStopLoss', tradeId: null }, trades, rules)).toEqual([])
    expect(isSingleTradeAlert({ kind: 'noStopLoss', tradeId: null })).toBe(false)
  })
})
