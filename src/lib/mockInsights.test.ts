import { beforeAll, describe, expect, it } from 'vitest'
import { mock, mockInsights, mockJournal } from './mockBackend'
import type { TradeData } from '../types/trade'
import type { Insight } from '../types/insights'
import { fr } from '../i18n/fr'

/**
 * Mêmes journaux que `insights::tests` (pulse-core, résultats calculés à la main) : le faux backend doit
 * produire les mêmes insights. Chaque journal vit sur son propre compte ; les dates sont très anciennes
 * pour ne jamais croiser les données de démonstration du faux backend (journal quotidien commun).
 */
const DAY = 86_400_000
const HOUR = 3_600_000
const BASE = 18_000 * DAY
const NOW = BASE + 20 * HOUR
let instrumentId = 0
let n = 0

async function account() {
  return (await mock.createAccount({ name: `Insights ${++n}`, kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
}

async function trade(accountId: number, day: number, size: string, exit: string, extra: Partial<TradeData> = {}, base = BASE) {
  const t: TradeData = {
    accountId, instrumentId, direction: 'long', size, multiplier: '1', entryPrice: '100', exitPrice: exit,
    entryTime: base + day * DAY + 9 * HOUR, exitTime: base + day * DAY + 10 * HOUR,
    tzOffsetMin: 0, plannedSl: '90', fees: '0', thesis: '', postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [],
    ...extra,
  }
  return (await mock.createTrade(t)).id
}

const get = (accountId: number, now = NOW, includeDismissed = false) => mockInsights.getInsights([accountId], 0, includeDismissed, now)
const keys = (v: Insight[]) => v.map((i) => i.messageKey)
const find = (v: Insight[], key: string) => v.find((i) => i.messageKey === key)!

beforeAll(async () => {
  instrumentId = (await mock.createInstrument({ symbol: 'INSIGHTTEST', name: '', assetClass: 'other', defaultMultiplier: '1' })).id
})

describe('mock des insights : mêmes résultats que pulse-core', () => {
  it('dérive du risque (journal R) : +23 %, seuil exact, baisse, disparition', async () => {
    const journalR = async (recent: string) => {
      const a = await account()
      const ids: number[] = []
      for (let i = 1; i <= 20; i++) ids.push(await trade(a, i - 20, i <= 10 ? '10' : recent, '100'))
      return { a, ids }
    }
    const { a, ids } = await journalR('12.3')
    const v = await get(a)
    expect(keys(v)).toEqual(['riskDrift.up'])
    const i = v[0]
    if (i.kind !== 'riskDrift') throw new Error()
    expect([i.situation, i.level, i.id, i.priority, i.category, i.source]).toEqual([`riskDrift:${a}:up`, 2, `riskDrift:${a}:up:2#1`, 'high', 'trend', 'risk'])
    expect(i.tradeIds).toEqual(ids)
    expect(i.period).toEqual({ basis: 'lastTrades', from: BASE - 19 * DAY + 10 * HOUR, to: BASE + 10 * HOUR, tradeCount: 20, days: null })
    expect(i.olderAvgRiskPct).toBeCloseTo(0.01, 12)
    expect(i.recentAvgRiskPct).toBeCloseTo(0.0123, 12)
    expect(i.change).toBeCloseTo(0.23, 9)
    expect([i.olderAvgRisk, i.recentAvgRisk, i.older.tradeIds]).toEqual(['100', '123', ids.slice(0, 10)])

    expect(keys(await get((await journalR('12')).a))).toEqual(['riskDrift.up'])
    expect(await get((await journalR('11.9')).a)).toEqual([])
    const down = await get((await journalR('7.5')).a)
    expect([keys(down), down[0].priority, down[0].level]).toEqual([['riskDrift.down'], 'low', 2])

    // Dix trades de plus à 1,23 % : les vingt derniers sont tous au même risque, l'insight disparaît.
    for (let i = 21; i <= 30; i++) await trade(a, i - 20, '12.3', '100')
    expect(await get(a, NOW + 10 * DAY)).toEqual([])
  })

  it('discipline et plan (journal P), frais (journal F)', async () => {
    const p = await account()
    for (let i = 1; i <= 20; i++) await trade(p, i - 20, '1', '100', { planFollowed: i <= 10 || i % 2 === 1 ? 'yes' : 'partial' })
    const v = await get(p)
    expect(keys(v)).toEqual(['disciplineTrend.down', 'planDrop'])
    if (v[0].kind !== 'disciplineTrend' || v[1].kind !== 'planDrop') throw new Error()
    expect(v[0].difference).toBeCloseTo(-15, 9)
    expect([v[0].level, v[1].level]).toEqual([1, 2])
    expect(v[1].difference).toBeCloseTo(-0.25, 12)

    const f = await account()
    for (let i = 1; i <= 20; i++) await trade(f, i - 20, '1', '100', { fees: i <= 10 ? '2' : '2.5' })
    const fees = await get(f)
    expect(keys(fees)).toEqual(['feesUp'])
    if (fees[0].kind !== 'feesUp') throw new Error()
    expect([fees[0].olderAvgFees, fees[0].recentAvgFees, fees[0].level]).toEqual(['2', '2.5', 1])
    expect(fees[0].change).toBeCloseTo(0.25, 12)
  })

  it('règle moins respectée (journal G) et taille après une perte (journal S)', async () => {
    const g = await account()
    const [r1, r2, r3] = [await mock.createRule('Insight règle 1'), await mock.createRule('Insight règle 2'), await mock.createRule('Insight règle 3')]
    for (let i = 1; i <= 12; i++) {
      const ruleChecks = [{ ruleId: r1.id, respected: i <= 8 }, { ruleId: r2.id, respected: true }]
      if (i >= 5) ruleChecks.push({ ruleId: r3.id, respected: i <= 8 })
      await trade(g, i - 12, '1', '100', { ruleChecks })
    }
    const v = await get(g)
    expect(keys(v)).toEqual(['disciplineTrend.down', 'ruleAdherenceDrop'])
    const r = v[1]
    if (r.kind !== 'ruleAdherenceDrop') throw new Error()
    expect([r.ruleId, r.checks, r.respected, r.level, r.filter]).toEqual([r1.id, 12, 8, 6, { kind: 'mistake', source: 'rule', id: r1.id }])
    expect(r.trend).toBeCloseTo(2 / 6 - 1, 12)
    expect(r.period).toEqual({ basis: 'days', from: BASE - 89 * DAY, to: BASE + DAY, tradeCount: 12, days: 90 })

    const s = await account()
    const ids: number[] = []
    for (let i = 1; i <= 11; i++) ids.push(await trade(s, i - 11, i % 2 ? '1' : '1.3', i % 2 ? '90' : '110'))
    const size = await get(s)
    expect(keys(size)).toEqual(['sizeUpAfterLoss'])
    if (size[0].kind !== 'sizeUpAfterLoss') throw new Error()
    expect(size[0].afterLossMean).toBeCloseTo(0.3, 9)
    expect(size[0].lossVsWin).toBeCloseTo(0.3 - (10 / 13 - 1), 7) // le ratio du mock a 8 décimales
    expect([size[0].level, size[0].tradeIds]).toEqual([5, [ids[1], ids[3], ids[5], ids[7], ids[9]]])
  })

  it('revanche et surtrading répétés (journal V)', async () => {
    const saved = await mock.getBehaviorSettings()
    await mock.setBehaviorSettings({ ...saved, maxTradesPerDay: 1 })
    try {
      const a = await account()
      const second: number[] = []
      for (const d of [-3, -1]) {
        await trade(a, d, '1', '90', { exitTime: BASE + d * DAY + 9 * HOUR + 30 * 60_000 })
        second.push(await trade(a, d, '2', '90', { entryTime: BASE + d * DAY + 9 * HOUR + 45 * 60_000, exitTime: BASE + d * DAY + 10 * HOUR + 30 * 60_000 }))
      }
      const v = await get(a)
      expect(keys(v)).toEqual(['revengePattern', 'overtradingPattern'])
      if (v[0].kind !== 'revengePattern' || v[1].kind !== 'overtradingPattern') throw new Error()
      expect([v[0].count, v[0].netPnl, v[0].level, v[0].tradeIds]).toEqual([2, '-40', 2, second])
      expect([v[1].dayCount, v[1].limit, v[1].tradeCount]).toEqual([2, 1, 2])
      expect(await get(a, NOW + 100 * DAY)).toEqual([])
    } finally {
      await mock.setBehaviorSettings(saved)
    }
  })

  it('meilleur et plus faible setup / session (journal B)', async () => {
    const a = await account()
    const [breakout, range, news] = [await mock.createTag('setup', 'Ins Breakout'), await mock.createTag('setup', 'Ins Range'), await mock.createTag('setup', 'Ins News')]
    const [london, ny] = [await mock.createTag('session', 'Ins Londres'), await mock.createTag('session', 'Ins New York')]
    const plan: [string, number[]][] = []
    for (let k = 0; k < 10; k++) {
      plan.push([k < 6 ? '120' : '95', [breakout.id, london.id]])
      plan.push([k < 3 ? '110' : '90', [range.id, ny.id]])
    }
    for (let k = 0; k < 3; k++) plan.push(['130', [news.id, london.id]])
    for (let k = 0; k < 2; k++) plan.push(['100', [ny.id]])
    for (const [k, [exit, tagIds]] of plan.entries()) await trade(a, k + 1 - plan.length, '1', exit, { tagIds })
    const v = await get(a)
    expect(keys(v)).toEqual(['weakSegment.setup', 'weakSegment.session', 'bestSegment.setup', 'bestSegment.session'])
    const best = find(v, 'bestSegment.setup')
    if (best.kind !== 'bestSegment') throw new Error()
    expect([best.tagId, best.summary.tradeCount, best.eligibleCount, best.filter, best.situation]).toEqual([breakout.id, 10, 2, { kind: 'setup', tagId: breakout.id }, `bestSegment:${a}:setup:${breakout.id}`])
    expect(best.summary.expectancyR).toBeCloseTo(1, 9)
    expect(best.baselineExpectancyR).toBeCloseTo(0.6, 9)
    const weak = find(v, 'weakSegment.session')
    if (weak.kind !== 'weakSegment') throw new Error()
    expect(weak.tagId).toBe(ny.id)
    expect(weak.summary.expectancyR).toBeCloseTo(-4 / 12, 9)
  })

  it('erreurs coûteuses (journal M), émotion avant l’entrée (journal E)', async () => {
    const a = await account()
    const m = await Promise.all([1, 2, 3, 4].map((k) => mock.createTag('mistake', `Ins M${k}`)))
    const rule = await mock.createRule('Insight règle 7')
    const spec: [number[], boolean, string][] = [
      [[0, 3], false, '90'], [[0, 3], false, '90'], [[0], false, '90'], [[1], true, '80'], [[1], true, '80'],
      [[2], false, '95'], [[2], false, '110'], [[2], false, '110'], [[2], false, '110'], [[3], true, '45'],
    ]
    for (const [k, [tags, broken, exit]] of spec.entries()) {
      await trade(a, k - 9, '1', exit, { tagIds: tags.map((t) => m[t].id), ruleChecks: broken ? [{ ruleId: rule.id, respected: false }] : [] })
    }
    const v = await get(a)
    expect(keys(v)).toEqual(['costlyMistake.rule', 'costlyMistake.tag', 'disciplineTrend.up'])
    if (v[0].kind !== 'costlyMistake' || v[1].kind !== 'costlyMistake') throw new Error()
    expect([v[0].mistakeId, v[0].cost, v[0].totalLosses, v[0].level]).toEqual([rule.id, '95', '130', 3])
    expect(v[0].shareOfLosses).toBeCloseTo(95 / 130, 7)
    expect([v[1].mistakeId, v[1].cost, v[1].label]).toEqual([m[3].id, '75', 'Ins M4'])

    const e = await account()
    const [fomo, calme, frustration] = [await mock.createTag('emotion', 'Ins FOMO'), await mock.createTag('emotion', 'Ins Calme'), await mock.createTag('emotion', 'Ins Frustration')]
    const exits = ['90', '90', '90', '110', '90', '110', '110', '90', '110', '110', '100', '110']
    for (const [k, exit] of exits.entries()) {
      const i = k + 1
      const emotions = []
      if (i <= 5) emotions.push({ moment: 'before' as const, tagId: fomo.id })
      else if (i <= 10) emotions.push({ moment: 'before' as const, tagId: calme.id })
      if ([1, 2, 3, 5, 8].includes(i)) emotions.push({ moment: 'after' as const, tagId: frustration.id })
      await trade(e, i - 12, '1', exit, { emotions })
    }
    const em = await get(e)
    expect(keys(em)).toEqual(['emotionLower'])
    if (em[0].kind !== 'emotionLower') throw new Error()
    expect([em[0].tagId, em[0].group.rTradeCount, em[0].others.rTradeCount, em[0].level]).toEqual([fomo.id, 5, 7, 4])
    expect(em[0].difference).toBeCloseTo(-0.6 - 4 / 7, 9)
  })

  it('facteur externe (journal X)', async () => {
    const base = BASE + 400 * DAY
    const a = await account()
    for (let i = 1; i <= 10; i++) {
      await trade(a, i - 10, '1', i <= 5 ? '90' : '110', { planFollowed: i <= 5 ? 'no' : 'yes' }, base)
      await mockJournal.saveJournalEntry({
        day: new Date(base + (i - 10) * DAY).toISOString().slice(0, 10), sleepQuality: i <= 5 ? 1 : 4, lateHours: false, wentWell: '', toImprove: '', notes: '',
      })
    }
    const v = await get(a, base + 20 * HOUR)
    expect(keys(v)).toEqual(['factorLower', 'disciplineTrend.up'])
    if (v[0].kind !== 'factorLower') throw new Error()
    expect([v[0].factor, v[0].presentDays, v[0].absentDays, v[0].level]).toEqual(['poorSleep', 5, 5, 2])
    expect(v[0].discipline.difference).toBeCloseTo(-60, 9)
    expect(v[0].expectancyR.difference).toBeCloseTo(-2, 9)
  })

  it('masquer : caché dans l’épisode, réapparaît sur aggravation ou nouvel épisode', async () => {
    const a = await account()
    const pair = async (d: number) => [
      await trade(a, d, '1', '95', { exitTime: BASE + d * DAY + 9 * HOUR + 10 * 60_000 }),
      await trade(a, d, '2', '105', { entryTime: BASE + d * DAY + 9 * HOUR + 20 * 60_000, exitTime: BASE + d * DAY + 9 * HOUR + 30 * 60_000 }),
    ]
    await pair(-3)
    await pair(-2)
    const first = `revengePattern:${a}:revenge:2#1`
    const v = await get(a)
    expect([v.map((i) => i.id), v[0].firstSeenAt]).toEqual([[first], NOW])
    await mockInsights.dismissInsight(first, NOW + 1)
    expect(await get(a, NOW + 2)).toEqual([])
    expect((await get(a, NOW + 2, true))[0].dismissedAt).toBe(NOW + 1)
    const third = await pair(-1)
    const worse = await get(a, NOW + 3)
    expect(worse.map((i) => i.id)).toEqual([`revengePattern:${a}:revenge:3#1`])
    await mockInsights.dismissInsight(worse[0].id, NOW + 4)
    for (const id of third) await mock.deleteTrade(id)
    expect(await get(a, NOW + 5)).toEqual([])
    expect((await get(a, NOW + 20 * DAY)).map((i) => i.id)).toEqual([`revengePattern:${a}:revenge:2#2`])
    const h = await mockInsights.getInsightHistory([a])
    expect(h.map((r) => [r.level, r.episode])).toEqual([[2, 2], [3, 1], [2, 1]])
    await expect(mockInsights.dismissInsight('nope')).rejects.toThrow()
  })

  it('chaque clé de message a un gabarit français', () => {
    const all = [
      'riskDrift.up', 'riskDrift.down', 'disciplineTrend.down', 'disciplineTrend.up', 'planDrop', 'ruleAdherenceDrop', 'feesUp', 'sizeUpAfterLoss',
      'revengePattern', 'overtradingPattern', 'costlyMistake.tag', 'costlyMistake.rule', 'emotionLower', 'factorLower',
      'bestSegment.setup', 'bestSegment.session', 'weakSegment.setup', 'weakSegment.session',
    ]
    for (const k of all) expect(typeof (fr.insights.messages as Record<string, unknown>)[k]).toBe('function')
    const text = Object.values(fr.insights.messages).map((f) => (f as (...a: unknown[]) => string)('X', 'Y', 'Z', 3)).join(' ') + Object.values(fr.insights.suggestions).join(' ')
    expect(text).not.toMatch(/parce que|à cause/i)
  })
})
