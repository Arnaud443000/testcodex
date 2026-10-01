import { describe, expect, it } from 'vitest'
import { resolveScope, statsQueryOf, type ScopeEnv } from './widgetScope'
import type { Account } from '../types/account'

const account = (id: number, currency = 'USD', archived = false): Account =>
  ({ id, name: `Compte ${id}`, kind: 'personal', broker: '', currency, initialCapital: '1000', createdAt: '', archived, hasHistory: false }) as Account

const env = (over: Partial<ScopeEnv> = {}): ScopeEnv => ({
  accounts: [account(1), account(2)],
  allAccounts: [account(1), account(2), account(3, 'USD', true)],
  selectedId: null,
  period: '3M',
  nowMs: Date.UTC(2026, 8, 29, 12),
  tzOffsetMin: 0,
  ...over,
})

describe('resolveScope', () => {
  it('suit la barre du haut quand le widget n’a pas de réglage propre', () => {
    const s = resolveScope({ period: null, accountId: null }, env())
    expect(s).toMatchObject({ accountIds: [], period: '3M', periodOverridden: false, currency: 'USD', mixed: false, accountMissing: false })
    expect(s.chosen).toHaveLength(2)
    expect(resolveScope({ period: null, accountId: null }, env({ selectedId: 2 })).accountIds).toEqual([2])
  })

  it('un réglage propre l’emporte sur la barre du haut', () => {
    const s = resolveScope({ period: '1W', accountId: 1 }, env({ selectedId: 2 }))
    expect(s).toMatchObject({ accountIds: [1], period: '1W', periodOverridden: true, ownAccountName: 'Compte 1' })
  })

  it('peut viser un compte archivé', () => {
    expect(resolveScope({ period: null, accountId: 3 }, env()).chosen.map((a) => a.id)).toEqual([3])
  })

  it('signale un compte disparu et des devises mélangées', () => {
    expect(resolveScope({ period: null, accountId: 99 }, env()).accountMissing).toBe(true)
    const mixed = resolveScope({ period: null, accountId: null }, env({ accounts: [account(1, 'USD'), account(2, 'EUR')] }))
    expect(mixed.mixed).toBe(true)
    expect(resolveScope({ period: null, accountId: 2 }, env({ accounts: [account(1, 'USD'), account(2, 'EUR')], allAccounts: [account(1, 'USD'), account(2, 'EUR')] })).mixed).toBe(false)
  })

  it('construit la requête de statistiques avec les bornes de la période du widget', () => {
    const q = statsQueryOf(resolveScope({ period: 'ALL', accountId: null }, env()))
    expect(q).toEqual({ accountIds: [], from: null, to: null })
    const week = statsQueryOf(resolveScope({ period: '1W', accountId: 1 }, env()))
    expect(week.accountIds).toEqual([1])
    expect(week.to! - week.from!).toBe(7 * 86_400_000)
  })
})

describe('resolveScope avec la portée du dashboard (calculée par pulse-core)', () => {
  const ws = (over: Partial<import('../types/dashboardLayout').WidgetScope>): import('../types/dashboardLayout').WidgetScope => ({
    uid: 'w', source: 'dashboard', accountIds: [2], accounts: [{ id: 2, name: 'Compte 2', currency: 'USD', archived: false }], currency: 'USD', mixedCurrency: false, accountMissing: false, ...over,
  })

  it('reprend les comptes calculés, sans toucher à la période', () => {
    const s = resolveScope({ uid: 'w', period: '1W', accountId: null }, env({ selectedId: 1, resolved: { w: ws({}) } }))
    expect(s).toMatchObject({ accountIds: [2], period: '1W', source: 'dashboard', ownAccountName: null, mixed: false })
    expect(s.chosen.map((a) => a.id)).toEqual([2])
  })

  it('nomme le compte seulement quand il est propre au widget, et relaie devises mélangées / compte absent', () => {
    expect(resolveScope({ uid: 'w', period: null, accountId: 2 }, env({ resolved: { w: ws({ source: 'widget' }) } })).ownAccountName).toBe('Compte 2')
    const mixed = resolveScope({ uid: 'w', period: null, accountId: null }, env({ resolved: { w: ws({ accountIds: [], accounts: [], mixedCurrency: true }) } }))
    expect(mixed.mixed).toBe(true)
    expect(resolveScope({ uid: 'w', period: null, accountId: 9 }, env({ resolved: { w: ws({ source: 'widget', accountMissing: true, accounts: [] }) } })).accountMissing).toBe(true)
  })

  it('sans entrée pour ce widget : comportement d’avant (le widget, puis la barre du haut)', () => {
    expect(resolveScope({ uid: 'x', period: null, accountId: null }, env({ selectedId: 2, resolved: {} })).source).toBe('topBar')
  })
})
