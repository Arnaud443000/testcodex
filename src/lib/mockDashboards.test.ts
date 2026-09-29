import { beforeEach, describe, expect, it } from 'vitest'
import { createDashboardsMock, ESSENTIAL, validateLayout } from './mockDashboards'
import type { DashboardScope, ScopeAccount, WidgetInstance } from '../types/dashboardLayout'

const acct = (id: number, currency = 'USD', archived = false): ScopeAccount => ({ id, name: `Compte ${id}`, currency, archived })
const ids = [1, 2]
let accounts: ScopeAccount[] = [acct(1), acct(2)]
const mk = () => createDashboardsMock(async () => accounts)
const widget = (over: Partial<WidgetInstance> = {}): WidgetInstance => ({
  uid: 'a', kind: 'capital', x: 0, y: 0, w: 10, h: 16, period: null, accountId: null, mode: null, ...over,
})

describe('faux backend des dashboards (miroir de pulse-core::dashboards)', () => {
  let m = mk()
  beforeEach(() => {
    accounts = [acct(1), acct(2)]
    m = mk()
    m.reset()
  })

  it('démarre sur Essentiel, le dashboard historique', async () => {
    const start = await m.getStartupDashboard()
    expect(start.key).toBe(ESSENTIAL)
    expect(start.isDefault).toBe(true)
    expect(start.widgets.map((x) => x.kind)).toEqual(['net_pnl_equity', 'capital', 'kpi', 'kpi', 'kpi', 'kpi', 'kpi', 'daily_results', 'calendar'])
    expect((await m.listDashboardLayouts()).map((d) => d.name)).toEqual(['Essentiel', 'Comportement', 'Analyse'])
  })

  it('tous les presets sont valides', async () => {
    for (const d of await m.listDashboardLayouts()) validateLayout((await m.getDashboardLayout(d.key)).widgets, ids)
  })

  it('enregistre, relit, renomme, choisit par défaut puis supprime', async () => {
    const saved = await m.saveDashboardLayout(null, ' Mon  suivi ', [widget(), widget({ uid: 'b', kind: 'calendar', x: 10, w: 13, h: 13, accountId: 2 })])
    expect(saved.name).toBe('Mon suivi')
    expect((await m.getDashboardLayout(saved.key)).widgets[1].accountId).toBe(2)
    expect((await m.renameDashboardLayout(saved.key, 'Suivi')).name).toBe('Suivi')
    expect((await m.setDefaultDashboardLayout(saved.key)).isDefault).toBe(true)
    expect((await m.getStartupDashboard()).key).toBe(saved.key)
    await m.deleteDashboardLayout(saved.key)
    expect((await m.getStartupDashboard()).key).toBe(ESSENTIAL)
  })

  it('enregistrer depuis un preset crée une copie sans toucher au preset', async () => {
    const before = await m.getDashboardLayout(ESSENTIAL)
    const copy = await m.saveDashboardLayout(ESSENTIAL, 'Ma copie', [widget()])
    expect(copy.builtin).toBe(false)
    expect(await m.getDashboardLayout(ESSENTIAL)).toEqual(before)
  })

  it('refuse les dispositions invalides et les noms réservés ou pris', async () => {
    const bad: WidgetInstance[][] = [
      [widget({ kind: 'nope' })],
      [widget(), widget({ uid: 'b', x: 9 })],
      [widget({ x: 21 })],
      [widget({ w: 1 })],
      [widget({ mode: 'x' })],
      [widget({ period: '1M' })],
      [widget({ kind: 'calendar', w: 13, h: 13, accountId: 99 })],
      [widget(), widget()],
    ]
    for (const layout of bad) await expect(m.saveDashboardLayout(null, 'X', layout)).rejects.toThrow()
    await m.saveDashboardLayout(null, 'Matin', [])
    await expect(m.saveDashboardLayout(null, ' matin ', [])).rejects.toThrow(/already exists/)
    await expect(m.saveDashboardLayout(null, 'essentiel', [])).rejects.toThrow(/built-in/)
    await expect(m.deleteDashboardLayout(ESSENTIAL)).rejects.toThrow()
    await expect(m.renameDashboardLayout(ESSENTIAL, 'Y')).rejects.toThrow()
    expect((await m.listDashboardLayouts()).length).toBe(4)
  })

  // --- Portée (3.8.9) : mêmes cas que les tests de pulse-core::dashboards ---
  const linked = (id: number): DashboardScope => ({ kind: 'account', accountId: id })
  const ALL: DashboardScope = { kind: 'all', accountId: null }
  const FOLLOW: DashboardScope = { kind: 'follow', accountId: null }

  it('un dashboard neuf et les presets suivent la barre du haut', async () => {
    expect((await m.listDashboardLayouts()).every((d) => d.scope.kind === 'follow')).toBe(true)
    expect((await m.saveDashboardLayout(null, 'Mien', [])).scope).toEqual(FOLLOW)
  })

  it('enregistre, relit et conserve la portée quand la disposition est enregistrée de nouveau', async () => {
    const mine = await m.saveDashboardLayout(null, 'Prop suivi', [widget()], linked(2))
    expect(mine.scope).toEqual(linked(2))
    expect((await m.listDashboardLayouts()).at(-1)?.scope).toEqual(linked(2))
    expect((await m.saveDashboardLayout(mine.key, 'Prop suivi', [])).scope).toEqual(linked(2))
    expect((await m.setDashboardScope(mine.key, ALL)).scope).toEqual(ALL)
    expect((await m.setDashboardScope(mine.key, FOLLOW)).scope).toEqual(FOLLOW)
    const copy = await m.saveDashboardLayout('preset:behavior', 'Comportement prop', [widget()], linked(1))
    expect(copy.scope).toEqual(linked(1))
    expect((await m.getDashboardLayout('preset:behavior')).scope).toEqual(FOLLOW)
  })

  it('refuse les portées invalides sans rien écrire', async () => {
    const mine = await m.saveDashboardLayout(null, 'Mien', [widget()])
    const bad: DashboardScope[] = [
      { kind: 'account', accountId: null },
      { kind: 'all', accountId: 1 },
      { kind: 'follow', accountId: 1 },
    ]
    for (const s of bad) {
      await expect(m.setDashboardScope(mine.key, s)).rejects.toThrow(/invalid input/)
      await expect(m.saveDashboardLayout(null, 'Autre', [], s)).rejects.toThrow(/invalid input/)
    }
    await expect(m.setDashboardScope(mine.key, linked(999))).rejects.toThrow(/not found/)
    await expect(m.setDashboardScope('preset:analysis', ALL)).rejects.toThrow(/invalid input/)
    await expect(m.setDashboardScope('custom:404', ALL)).rejects.toThrow(/not found/)
    expect((await m.listDashboardLayouts()).length).toBe(4)
    expect((await m.getDashboardLayout(mine.key)).scope).toEqual(FOLLOW)
  })

  it('suit la barre du haut, lit tous les comptes actifs, ou son propre compte', async () => {
    const follow = await m.resolveDashboardScope(FOLLOW, [], null)
    expect([follow.scope.effective, follow.scope.accountIds, follow.scope.accounts.length]).toEqual(['follow', [], 2])
    expect((await m.resolveDashboardScope(FOLLOW, [], 2)).scope.accountIds).toEqual([2])
    const all = await m.resolveDashboardScope(ALL, [], 1)
    expect([all.scope.effective, all.scope.accountIds, all.scope.accounts.length]).toEqual(['all', [], 2])
    const own = await m.resolveDashboardScope(linked(2), [], 1)
    expect([own.scope.effective, own.scope.accountIds, own.scope.currency, own.scope.notices]).toEqual(['account', [2], 'USD', []])
    accounts = [acct(1, 'USD', true), acct(2)]
    expect((await m.resolveDashboardScope(ALL, [], null)).scope.accounts.map((a) => a.id)).toEqual([2])
  })

  it('ne mélange jamais deux devises', async () => {
    accounts = [acct(1, 'USD'), acct(2, 'EUR')]
    expect((await m.resolveDashboardScope(ALL, [], null)).scope.mixedCurrency).toBe(true)
    expect((await m.resolveDashboardScope(FOLLOW, [], null)).scope.mixedCurrency).toBe(true)
    const one = (await m.resolveDashboardScope(linked(2), [], null)).scope
    expect([one.mixedCurrency, one.currency]).toEqual([false, 'EUR'])
    accounts = [acct(1, 'USD', true), acct(2, 'EUR'), acct(3, 'EUR')]
    const all = (await m.resolveDashboardScope(ALL, [], null)).scope
    expect([all.mixedCurrency, all.currency, all.accounts.length]).toEqual([false, 'EUR', 2])
    accounts = []
    const none = (await m.resolveDashboardScope(ALL, [], null)).scope
    expect([none.currency, none.mixedCurrency, none.accounts.length]).toEqual([null, false, 0])
  })

  it('un widget lit son compte, puis la portée du dashboard, puis la barre du haut', async () => {
    accounts = [acct(1), acct(2), acct(3, 'EUR')]
    const widgets = [widget({ uid: 'free' }), widget({ uid: 'pinned', kind: 'calendar', x: 10, w: 13, h: 13, accountId: 2 })]
    let r = await m.resolveDashboardScope(FOLLOW, widgets, 1)
    expect([r.widgets[0].source, r.widgets[0].accountIds, r.widgets[1].source, r.widgets[1].accountIds]).toEqual(['topBar', [1], 'widget', [2]])
    r = await m.resolveDashboardScope(linked(1), widgets, 2)
    expect([r.widgets[0].source, r.widgets[0].accountIds, r.widgets[1].source, r.widgets[1].accountIds]).toEqual(['dashboard', [1], 'widget', [2]])
    r = await m.resolveDashboardScope(ALL, widgets, null)
    expect([r.scope.mixedCurrency, r.widgets[0].mixedCurrency, r.widgets[1].mixedCurrency, r.widgets[0].accounts.length]).toEqual([true, true, false, 3])
    expect(r.widgets[1].currency).toBe('USD')
  })

  it('signale un compte de widget introuvable dans un brouillon', async () => {
    const r = await m.resolveDashboardScope(FOLLOW, [widget({ kind: 'calendar', w: 13, h: 13, accountId: 4242 })], null)
    expect([r.widgets[0].accountMissing, r.widgets[0].accounts.length]).toEqual([true, 0])
  })

  it('la suppression du compte lié garde le dashboard, qui relit la barre du haut', async () => {
    const mine = await m.saveDashboardLayout(null, 'Prop', [widget()], linked(2))
    accounts = [acct(1)]
    const loaded = await m.getDashboardLayout(mine.key)
    expect(loaded.widgets).toHaveLength(1)
    expect(loaded.scope).toEqual({ kind: 'account', accountId: null })
    const r = (await m.resolveDashboardScope(loaded.scope, [], 1)).scope
    expect([r.declared, r.effective, r.accountIds, r.notices]).toEqual(['account', 'follow', [1], ['accountDeleted']])
    expect((await m.saveDashboardLayout(mine.key, 'Prop', [widget()])).scope).toEqual({ kind: 'account', accountId: null })
    expect((await m.setDashboardScope(mine.key, linked(1))).scope).toEqual(linked(1))
  })

  it('un compte lié archivé reste lu, avec un avertissement', async () => {
    const mine = await m.saveDashboardLayout(null, 'Ancien', [], linked(2))
    accounts = [acct(1), acct(2, 'USD', true)]
    const r = (await m.resolveDashboardScope(mine.scope, [], null)).scope
    expect([r.effective, r.accountIds, r.accounts[0].archived, r.notices]).toEqual(['account', [2], true, ['accountArchived']])
    await expect(m.saveDashboardLayout(null, 'Encore', [], linked(2))).resolves.toBeTruthy()
  })
})
