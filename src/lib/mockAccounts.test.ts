import { describe, expect, it } from 'vitest'
import { mock } from './mockBackend'
import type { TradeData } from '../types/trade'

const DAY = 86_400_000
const H = 3_600_000
const NOW = 20_725 * DAY + 12 * H

const account = (name: string) =>
  mock.createAccount({ name, kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })

async function addTrade(accountId: number) {
  const ins = (await mock.listInstruments())[0]
  const exitTime = NOW - DAY
  return mock.createTrade({
    accountId, instrumentId: ins.id, direction: 'long', size: '1', multiplier: '1', entryPrice: '100', exitPrice: '110',
    entryTime: exitTime - H, exitTime, tzOffsetMin: 0, plannedSl: null, plannedTp: null, fees: '0', thesis: '', postMortem: '',
    tagIds: [], emotions: [], ruleChecks: [], checklist: [],
  } as unknown as TradeData)
}

const dash = (accountIds: number[]) => mock.getDashboard({ accountIds, period: 'all', nowMs: NOW, tzOffsetMin: 0 })

describe('modifier et archiver un compte (mock)', () => {
  it('modifie le compte ; la devise se verrouille avec de l’historique', async () => {
    const a = await account('Principal')
    const u = { name: ' FTMO ', kind: 'prop' as const, broker: 'IC', currency: 'EUR', initialCapital: '25000.50' }
    expect((await mock.updateAccount(a.id, u)).currency).toBe('EUR')
    await addTrade(a.id)
    expect((await mock.listAccounts()).find((x) => x.id === a.id)?.hasHistory).toBe(true)
    await expect(mock.updateAccount(a.id, { ...u, currency: 'USD' })).rejects.toThrow('currency_locked')
    expect((await mock.updateAccount(a.id, { ...u, name: 'B' })).name).toBe('B')
    await expect(mock.updateAccount(a.id, { ...u, name: '  ' })).rejects.toThrow()
    await expect(mock.updateAccount(a.id, { ...u, initialCapital: '1,5' })).rejects.toThrow()
    await mock.setAccountArchived(a.id, true) // hors des totaux par défaut : ne mélange pas les devises
  })

  it('un compte archivé sort des totaux par défaut mais reste lisible et non supprimable', async () => {
    const keep = await account('Actif')
    const old = await account('Ancien')
    await addTrade(keep.id)
    await addTrade(old.id)
    const before = (await dash([])).report.summary.tradeCount

    expect((await mock.setAccountArchived(old.id, true)).archived).toBe(true)
    expect((await dash([])).report.summary.tradeCount).toBe(before - 1)
    expect((await dash([old.id])).report.summary.tradeCount).toBe(1)
    expect((await mock.listTrades()).some((t) => t.accountId === old.id)).toBe(false)
    expect((await mock.listTrades({ accountIds: [old.id] })).length).toBe(1)
    await expect(mock.deleteAccount(old.id)).rejects.toThrow('account_in_use')
    await expect(addTrade(old.id)).rejects.toThrow('account_archived')

    await mock.setAccountArchived(old.id, false)
    expect((await dash([])).report.summary.tradeCount).toBe(before)
  })
})
