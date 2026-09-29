import { beforeAll, describe, expect, it } from 'vitest'
import { fr } from '../i18n/fr'
import type { TradeData } from '../types/trade'
import { insightHint, insightMessage } from './insightsView'
import { mock, mockInsights, mockJournal } from './mockBackend'

/**
 * Lot 19 bis, point 6 : le faux backend, les vrais textes français et le formatage de l'interface ensemble.
 * Mêmes journaux que `mockInsights.test.ts` (dates très anciennes pour ne pas croiser les données de démonstration).
 */
const DAY = 86_400_000
const HOUR = 3_600_000
const BASE = 19_000 * DAY
const NOW = BASE + 20 * HOUR
let instrumentId = 0
let n = 0
const plain = (s: string) => s.replace(/[  ]/g, ' ')

const account = async () => (await mock.createAccount({ name: `Texte ${++n}`, kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
async function trade(accountId: number, day: number, size: string, exit: string, extra: Partial<TradeData> = {}, base = BASE) {
  const t: TradeData = {
    accountId, instrumentId, direction: 'long', size, multiplier: '1', entryPrice: '100', exitPrice: exit,
    entryTime: base + day * DAY + 9 * HOUR, exitTime: base + day * DAY + 10 * HOUR,
    tzOffsetMin: 0, plannedSl: '90', fees: '0', thesis: '', postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [], ...extra,
  }
  return (await mock.createTrade(t)).id
}
const sentences = async (accountId: number, now = NOW) =>
  (await mockInsights.getInsights([accountId], 0, false, now)).map((i) => ({ key: i.messageKey, text: plain(insightMessage(fr, i)), hint: insightHint(fr, i) }))

beforeAll(async () => {
  instrumentId = (await mock.createInstrument({ symbol: 'TEXTTEST', name: '', assetClass: 'other', defaultMultiplier: '1' })).id
})

describe('faux backend + textes réels : phrases complètes', () => {
  it('dérive du risque : 1,00 % → 1,23 %, +23 %, piste', async () => {
    const a = await account()
    for (let i = 1; i <= 20; i++) await trade(a, i - 20, i <= 10 ? '10' : '12.3', '100')
    const v = await sentences(a)
    expect(v).toHaveLength(1)
    expect(v[0].key).toBe('riskDrift.up')
    expect(v[0].text).toBe('Votre risque moyen par trade est passé de 1,00 % à 1,23 % du capital (+23 %) : vos 10 trades les plus récents contre les 10 précédents.')
    expect(v[0].hint).toBe(fr.insights.suggestions['riskDrift.up'])
  })

  it('discipline, plan et frais', async () => {
    const p = await account()
    for (let i = 1; i <= 20; i++) await trade(p, i - 20, '1', '100', { planFollowed: i <= 10 || i % 2 === 1 ? 'yes' : 'partial' })
    const v = await sentences(p)
    expect(v.map((x) => x.key)).toEqual(['disciplineTrend.down', 'planDrop'])
    expect(v[1].text).toBe('Le respect déclaré de votre plan est passé de 100 % à 75 % sur vos 10 trades les plus récents, par rapport aux 10 précédents.')

    const f = await account()
    for (let i = 1; i <= 20; i++) await trade(f, i - 20, '1', '100', { fees: i <= 10 ? '2' : '2.5' })
    expect((await sentences(f))[0].text).toBe('Vos frais moyens par trade sont passés de 2,00 $ à 2,50 $ (+25 %) sur vos 10 trades les plus récents.')
  })

  it('facteur externe : phrase composée avec les deux écarts', async () => {
    const base = BASE + 400 * DAY
    const a = await account()
    for (let i = 1; i <= 10; i++) {
      await trade(a, i - 10, '1', i <= 5 ? '90' : '110', { planFollowed: i <= 5 ? 'no' : 'yes' }, base)
      await mockJournal.saveJournalEntry({ day: new Date(base + (i - 10) * DAY).toISOString().slice(0, 10), sleepQuality: i <= 5 ? 1 : 4, lateHours: false, wentWell: '', toImprove: '', notes: '' })
    }
    const factor = (await sentences(a, base + 20 * HOUR)).find((x) => x.key === 'factorLower')!
    expect(factor.text).toBe(
      'Les jours de mauvais sommeil, votre discipline était plus basse de 60 points et votre expectancy était plus basse de 2,00 R (constat sur les mêmes jours, pas une cause).',
    )
  })

  it('aucune phrase de aucun journal ne contient de trou (undefined, NaN, null, [object)', async () => {
    const a = await account()
    for (let i = 1; i <= 20; i++) await trade(a, i - 20, i <= 10 ? '10' : '12.3', i % 2 ? '90' : '110', { fees: i <= 10 ? '2' : '3' })
    for (const s of await sentences(a)) expect(s.text).not.toMatch(/undefined|NaN|null|\[object|Infinity/)
  })
})
