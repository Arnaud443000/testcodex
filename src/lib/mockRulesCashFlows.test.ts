import { beforeAll, describe, expect, it } from 'vitest'
import { mock } from './mockBackend'
import type { TradeData } from '../types/trade'

const DAY = 86_400_000
const H = 3_600_000
const NOW = 20_725 * DAY + 12 * H
let accountId = 0

beforeAll(async () => {
  accountId = (await mock.createAccount({ name: 'Main', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
  const ins = (await mock.listInstruments())[0]
  const exitTime = NOW - DAY
  const trade = {
    accountId, instrumentId: ins.id, direction: 'long', size: '1', multiplier: '1', entryPrice: '100', exitPrice: '110',
    entryTime: exitTime - H, exitTime, tzOffsetMin: 0, plannedSl: null, plannedTp: null, fees: '0', thesis: '', postMortem: '',
    tagIds: [], emotions: [], ruleChecks: [], checklist: [],
  } as unknown as TradeData
  await mock.createTrade(trade)
})

describe('règles et checklist (mock)', () => {
  it('crée, renomme, archive et restaure sans jamais supprimer', async () => {
    const r = await mock.createRule('  Pas de trade après 2 pertes ')
    expect(r.text).toBe('Pas de trade après 2 pertes')
    expect((await mock.renameRule(r.id, 'Pas de trade après 3 pertes')).text).toBe('Pas de trade après 3 pertes')
    await expect(mock.renameRule(r.id, '   ')).rejects.toThrow()
    await mock.setRuleArchived(r.id, true)
    expect(await mock.listRules(false)).toEqual([])
    expect((await mock.listRules(true)).map((x) => x.archived)).toEqual([true])
    await mock.setRuleArchived(r.id, false)
    expect(await mock.listRules(false)).toHaveLength(1)

    const c = await mock.createChecklistItem('Stop placé')
    await mock.renameChecklistItem(c.id, 'Stop loss placé')
    await mock.setChecklistItemArchived(c.id, true)
    expect(await mock.listChecklist(false)).toEqual([])
    expect((await mock.listChecklist(true))[0].label).toBe('Stop loss placé')
  })
})

describe('dépôts et retraits (mock)', () => {
  it('bougent le capital mais jamais le résultat ni la courbe d’équité', async () => {
    const query = { accountIds: [accountId], period: 'all' as const, nowMs: NOW, tzOffsetMin: 0 }
    const before = await mock.getDashboard(query)
    const deposit = await mock.createCashFlow({ accountId, kind: 'deposit', amount: '5000', occurredAt: NOW - 2 * DAY, tzOffsetMin: 0, note: ' virement ' })
    await mock.createCashFlow({ accountId, kind: 'withdrawal', amount: '2000', occurredAt: NOW - 12 * H, tzOffsetMin: 0, note: '' })
    const after = await mock.getDashboard(query)
    expect(after.report.summary.netPnl).toBe(before.report.summary.netPnl)
    expect(after.report.equityCurve).toEqual(before.report.equityCurve)
    expect(before.report.currentCapital).toBe('10010')
    expect(after.report.currentCapital).toBe('13010')
    expect([after.report.totalDeposits, after.report.totalWithdrawals]).toEqual(['5000', '2000'])
    expect(deposit.note).toBe('virement')

    expect((await mock.listCashFlows(accountId)).map((f) => f.kind)).toEqual(['deposit', 'withdrawal'])
    await mock.deleteCashFlow(deposit.id)
    expect((await mock.getDashboard(query)).report.currentCapital).toBe('8010')
  })
  it('refuse un montant nul ou négatif et un compte qui contient des mouvements', async () => {
    for (const amount of ['0', '-5', 'abc']) {
      await expect(mock.createCashFlow({ accountId, kind: 'deposit', amount, occurredAt: NOW, tzOffsetMin: 0, note: '' })).rejects.toThrow()
    }
    await expect(mock.deleteAccount(accountId)).rejects.toThrow('account_in_use')
  })
})
