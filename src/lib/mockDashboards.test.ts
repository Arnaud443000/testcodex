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

  it('widget Prop firm (lot 33) : même ligne que la bibliothèque de pulse-core, sans période', async () => {
    const d = (await m.listWidgetCatalog()).find((x) => x.kind === 'prop_firm')!
    expect([d.category, d.period, d.account, d.modes.length, d.defaultW, d.defaultH, d.minW, d.minH]).toEqual(['tracking', false, true, 0, 10, 16, 8, 12])
    validateLayout([widget({ uid: 'p', kind: 'prop_firm', w: 10, h: 16 })], ids)
    expect(() => validateLayout([widget({ uid: 'p', kind: 'prop_firm', w: 8, h: 11 })], ids)).toThrow()
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

  // --- Duplication, export, import (3.8.7) : mêmes cas que les tests de pulse-core::dashboards::transfer ---
  const rich = (prop: number) =>
    m.saveDashboardLayout(
      null,
      'Prop firm',
      [
        widget({ uid: 'a' }),
        widget({ uid: 'b', kind: 'calendar', x: 10, w: 13, h: 13, accountId: prop }),
        widget({ uid: 'k', kind: 'kpi', x: 0, y: 16, w: 6, h: 6, period: '1M', mode: 'expectancy' }),
        widget({ uid: 'e', kind: 'emotions', x: 6, y: 16, w: 12, h: 18, mode: 'after' }),
      ],
      linked(prop),
    )
  const fileOf = (widgets: string) => `{"format":"pulse-dashboard","version":1,"name":"Reçu","scope":{"kind":"follow"},"widgets":${widgets}}`
  const refused = async (text: string): Promise<string> => {
    const before = (await m.listDashboardLayouts()).length
    const err = await m.importDashboardConfigText(text).then(() => 'IMPORTED', (e: Error) => e.message)
    expect(await m.listDashboardLayouts(), `rien n'est écrit : ${text.slice(0, 50)}`).toHaveLength(before)
    return err
  }
  const cap = (uid: string, x: number, y: number, w: number, h: number) => `{"uid":"${uid}","kind":"capital","x":${x},"y":${y},"w":${w},"h":${h}}`

  it('duplique en gardant disposition, réglages et portée, sans toucher à la source ni au défaut', async () => {
    const src = await rich(2)
    await m.setDefaultDashboardLayout(src.key)
    const copy = await m.duplicateDashboardLayout(src.key)
    expect([copy.name, copy.widgets, copy.scope, copy.builtin, copy.isDefault]).toEqual(['Prop firm (copie)', src.widgets, linked(2), false, false])
    expect((await m.duplicateDashboardLayout(src.key)).name).toBe('Prop firm (copie 2)')
    expect((await m.getStartupDashboard()).key).toBe(src.key)
    await m.saveDashboardLayout(copy.key, copy.name, [])
    expect((await m.getDashboardLayout(src.key)).widgets).toHaveLength(4)
    expect((await m.duplicateDashboardLayout(src.key, ' Mon  départ ')).name).toBe('Mon départ')
    await expect(m.duplicateDashboardLayout(src.key, 'mon départ')).rejects.toThrow(/already exists/)
    await expect(m.duplicateDashboardLayout(src.key, 'Essentiel')).rejects.toThrow(/built-in/)
    await expect(m.duplicateDashboardLayout('custom:404')).rejects.toThrow(/not found/)
  })

  it('duplique un preset, le nom ne dépasse jamais la limite, une portée orpheline devient « barre du haut »', async () => {
    const copy = await m.duplicateDashboardLayout('preset:analysis')
    expect([copy.name, copy.builtin, copy.scope]).toEqual(['Analyse (copie)', false, FOLLOW])
    expect(copy.widgets).toEqual((await m.getDashboardLayout('preset:analysis')).widgets)
    const src = await m.saveDashboardLayout(null, 'x'.repeat(60), [])
    const long = await m.duplicateDashboardLayout(src.key)
    expect([...long.name].length).toBeLessThanOrEqual(60)
    expect(long.name.endsWith(' (copie)')).toBe(true)
    const mine = await m.saveDashboardLayout(null, 'Lié', [], linked(2))
    accounts = [acct(1)]
    expect((await m.duplicateDashboardLayout(mine.key)).scope).toEqual(FOLLOW)
  })

  it('exporte un fichier versionné, sans identifiant de cette base', async () => {
    const src = await rich(2)
    await m.exportDashboardConfig(src.key, 'x.json')
    const text = m.readExportedFile('x.json') ?? ''
    const v = JSON.parse(text)
    expect([v.format, v.version, v.name, v.scope.kind]).toEqual(['pulse-dashboard', 1, 'Prop firm', 'account'])
    expect(v.scope.account).toEqual({ name: 'Compte 2', currency: 'USD' })
    expect(v.widgets).toHaveLength(4)
    expect(text).not.toMatch(/accountId|account_id|custom:/)
    await m.exportDashboardConfig(src.key, 'y.json')
    expect(m.readExportedFile('y.json')).toBe(text)
    accounts = [acct(1)]
    await m.exportDashboardConfig(src.key, 'z.json')
    const orphan = JSON.parse(m.readExportedFile('z.json') ?? '')
    expect([orphan.scope.kind, orphan.scope.account]).toEqual(['follow', null])
    expect(orphan.widgets.every((w: { account: unknown }) => w.account === null)).toBe(true)
  })

  it('exporter puis importer redonne le même dashboard, sans jamais écraser', async () => {
    const src = await rich(2)
    await m.exportDashboardConfig(src.key, 'p.json')
    const again = await m.importDashboardConfig('p.json')
    expect(again.warnings).toEqual([{ code: 'renamed', from: 'Prop firm', to: 'Prop firm (importé)' }])
    expect([again.layout.widgets, again.layout.scope, again.layout.builtin, again.layout.isDefault]).toEqual([src.widgets, linked(2), false, false])
    expect((await m.getDashboardLayout(src.key)).widgets).toEqual(src.widgets)
    expect((await m.importDashboardConfig('p.json')).layout.name).toBe('Prop firm (importé 2)')
    await m.deleteDashboardLayout(src.key)
    const back = await m.importDashboardConfig('p.json')
    expect([back.warnings, back.layout.name, back.layout.widgets, back.layout.scope]).toEqual([[], 'Prop firm', src.widgets, linked(2)])
  })

  it('un preset revient sous un autre nom', async () => {
    await m.exportDashboardConfig('preset:behavior', 'b.json')
    const r = await m.importDashboardConfig('b.json')
    expect([r.layout.name, r.warnings.length]).toEqual(['Comportement (importé)', 1])
    expect(r.layout.widgets).toEqual((await m.getDashboardLayout('preset:behavior')).widgets)
  })

  it('retrouve les comptes par nom et devise, sinon les remet sur « compte global » avec avertissement', async () => {
    const src = await rich(2)
    await m.exportDashboardConfig(src.key, 'p.json')
    // Un autre PC : le même compte, autre identifiant, nom écrit autrement.
    accounts = [{ id: 7, name: 'Perso', currency: 'EUR', archived: false }, { id: 8, name: '  compte 2 ', currency: 'usd', archived: false }]
    await m.deleteDashboardLayout(src.key).catch(() => undefined)
    const ok = await m.importDashboardConfig('p.json')
    expect(ok.warnings).toEqual([])
    expect(ok.layout.scope).toEqual(linked(8))
    expect(ok.layout.widgets.find((w) => w.uid === 'b')?.accountId).toBe(8)
    // Même nom, autre devise : ce n'est pas le même compte.
    accounts = [{ id: 7, name: 'Compte 2', currency: 'EUR', archived: false }]
    const lost = await m.importDashboardConfig('p.json')
    expect(lost.layout.scope).toEqual(FOLLOW)
    expect(lost.layout.widgets.every((w) => w.accountId === null)).toBe(true)
    expect(lost.warnings).toEqual(
      expect.arrayContaining([
        { code: 'unknownScopeAccount', name: 'Compte 2' },
        { code: 'unknownAccount', name: 'Compte 2', widgetKind: 'calendar' },
      ]),
    )
    expect(lost.warnings.filter((w) => w.code !== 'renamed')).toHaveLength(2)
    expect(lost.layout.widgets.find((w) => w.uid === 'k')?.period).toBe('1M')
    // Deux comptes qui correspondent : on ne devine pas.
    accounts = [acct(1), { id: 3, name: 'compte 2', currency: 'USD', archived: false }, { id: 4, name: 'Compte 2', currency: 'USD', archived: false }]
    expect((await m.importDashboardConfig('p.json')).layout.scope).toEqual(FOLLOW)
  })

  it('ignore les widgets inconnus avec un avertissement', async () => {
    const r = await m.importDashboardConfigText(
      fileOf(`[${cap('a', 0, 0, 10, 16)},{"uid":"z","kind":"hologram","x":10,"y":0,"w":6,"h":6,"someFutureField":1},{"uid":"k","kind":"kpi","x":10,"y":0,"w":6,"h":6,"mode":"win_rate"}]`),
    )
    expect(r.layout.widgets.map((w) => w.uid)).toEqual(['a', 'k'])
    expect(r.warnings).toEqual([{ code: 'unknownWidget', kind: 'hologram' }])
    const only = await m.importDashboardConfigText(fileOf('[{"uid":"z","kind":"hologram","x":0,"y":0,"w":1,"h":1}]').replace('Reçu', 'Vide'))
    expect([only.layout.widgets.length, only.warnings.length]).toEqual([0, 1])
  })

  it('refuse un fichier vide, corrompu, étranger ou trop récent, avec un code explicite et sans rien écrire', async () => {
    await m.saveDashboardLayout(null, 'Déjà là', [])
    expect(await refused('')).toBe('invalid input: dashboard_import:empty')
    expect(await refused(' \n\t ')).toBe('invalid input: dashboard_import:empty')
    expect(await refused('{not json')).toMatch(/dashboard_import:corrupt/)
    expect(await refused(fileOf('[]').slice(0, 40))).toMatch(/dashboard_import:corrupt/)
    for (const foreign of ['[]', '42', 'null', '{"name":"x"}', '{"format":"other","version":1}']) expect(await refused(foreign)).toBe('invalid input: dashboard_import:not_a_dashboard')
    const newer = '{"format":"pulse-dashboard","version":2,"name":"X","layout":{"tabs":[]},"scope":{"kind":"quantum"}}'
    expect(await refused(newer)).toBe('invalid input: dashboard_import:too_new:2')
    for (const v of ['"version":0', '"version":"1"', '"version":1.5', '"version":-1', '"version":null']) {
      expect(await refused(`{"format":"pulse-dashboard",${v},"name":"X","scope":{"kind":"follow"},"widgets":[]}`)).toMatch(/dashboard_import:corrupt/)
    }
    expect(await refused('{"format":"pulse-dashboard","name":"X","scope":{"kind":"follow"},"widgets":[]}')).toMatch(/dashboard_import:corrupt/)
    expect(await refused(' '.repeat(1_000_001))).toBe('invalid input: dashboard_import:too_large')
  })

  it('refuse les champs manquants, en trop ou mal typés', async () => {
    const wrap = (name: string, scope: string, widgets: string) => `{"format":"pulse-dashboard","version":1${name}${scope}${widgets}}`
    const n = ',"name":"X"'
    const s = ',"scope":{"kind":"follow"}'
    const w = ',"widgets":[]'
    const cases: [string, string][] = [
      ['sans nom', wrap('', s, w)],
      ['sans portée', wrap(n, '', w)],
      ['sans widgets', wrap(n, s, '')],
      ['nom numérique', wrap(',"name":7', s, w)],
      ['widgets objet', wrap(n, s, ',"widgets":{}')],
      ['champ inconnu', wrap(n, s, w).replace('"version":1', '"version":1,"extra":true')],
      ['portée inconnue', wrap(n, ',"scope":{"kind":"everywhere"}', w)],
      ['compte sans compte', wrap(n, ',"scope":{"kind":"account"}', w)],
      ['suivre avec un compte', wrap(n, ',"scope":{"kind":"follow","account":{"name":"P","currency":"USD"}}', w)],
      ['compte sans devise', wrap(n, ',"scope":{"kind":"account","account":{"name":"P"}}', w)],
      ['widget sans kind', wrap(n, s, ',"widgets":[{"uid":"a","x":0,"y":0,"w":10,"h":16}]')],
      ['kind numérique', wrap(n, s, ',"widgets":[{"uid":"a","kind":3,"x":0,"y":0,"w":10,"h":16}]')],
      ['widget sans taille', wrap(n, s, ',"widgets":[{"uid":"a","kind":"capital","x":0,"y":0}]')],
      ['coordonnée texte', wrap(n, s, ',"widgets":[{"uid":"a","kind":"capital","x":"0","y":0,"w":10,"h":16}]')],
      ['champ en trop', wrap(n, s, ',"widgets":[{"uid":"a","kind":"capital","x":0,"y":0,"w":10,"h":16,"accountId":1}]')],
      ['widget non objet', wrap(n, s, ',"widgets":[7]')],
    ]
    for (const [label, text] of cases) expect(await refused(text), label).toMatch(/dashboard_import:corrupt/)
  })

  it('refuse une disposition invalide en entier', async () => {
    const many = `[${Array.from({ length: 61 }, (_, i) => cap(`u${i}`, 0, i * 2, 7, 10)).join(',')}]`
    const cases: [string, string][] = [
      ['chevauchement', `[${cap('a', 0, 0, 10, 16)},${cap('b', 9, 0, 10, 16)}]`],
      ['hors grille', `[${cap('a', 25, 0, 10, 16)}]`],
      ['sous la grille', `[${cap('a', 0, 295, 10, 16)}]`],
      ['négatif', `[${cap('a', -1, 0, 10, 16)}]`],
      ['trop petit', `[${cap('a', 0, 0, 2, 2)}]`],
      ['même uid', `[${cap('a', 0, 0, 10, 16)},${cap('a', 10, 0, 10, 16)}]`],
      ['uid vide', `[${cap('', 0, 0, 10, 16)}]`],
      ['mode inconnu', '[{"uid":"k","kind":"kpi","x":0,"y":0,"w":6,"h":6,"mode":"sharpe"}]'],
      ['mode sur un widget sans mode', '[{"uid":"a","kind":"capital","x":0,"y":0,"w":10,"h":16,"mode":"x"}]'],
      ['période inconnue', '[{"uid":"k","kind":"kpi","x":0,"y":0,"w":6,"h":6,"period":"2W"}]'],
      ['période sur un widget sans période', '[{"uid":"a","kind":"capital","x":0,"y":0,"w":10,"h":16,"period":"1M"}]'],
      ['trop de widgets', many],
    ]
    for (const [label, widgets] of cases) expect(await refused(fileOf(widgets)), label).toMatch(/dashboard_import:invalid/)
  })

  it('refuse un mauvais nom, renomme un nom pris sans jamais écraser', async () => {
    const named = (name: string) => fileOf('[]').replace('Reçu', name)
    expect(await refused(named('   '))).toMatch(/dashboard_import:invalid/)
    expect(await refused(named('x'.repeat(61)))).toMatch(/dashboard_import:invalid/)
    const mine = await m.saveDashboardLayout(null, 'Mon suivi', [widget()])
    for (const [given, expected] of [[' mon   SUIVI ', 'mon SUIVI (importé)'], ['essentiel', 'essentiel (importé)']]) {
      const r = await m.importDashboardConfigText(named(given))
      expect(r.layout.name).toBe(expected)
      expect(r.warnings.some((x) => x.code === 'renamed')).toBe(true)
    }
    expect((await m.getDashboardLayout(mine.key)).widgets).toHaveLength(1)
    const long = 'y'.repeat(60)
    await m.importDashboardConfigText(named(long))
    const r = await m.importDashboardConfigText(named(long))
    expect([...r.layout.name].length).toBeLessThanOrEqual(60)
    expect(r.layout.name.endsWith('(importé)')).toBe(true)
  })

  it('accepte une marque d’ordre des octets ; un fichier absent est une erreur ; l’import ne change pas le défaut', async () => {
    expect((await m.importDashboardConfigText(`﻿${fileOf('[]')}`)).layout.name).toBe('Reçu')
    await expect(m.importDashboardConfig('nulle-part.json')).rejects.toThrow(/io error/)
    const mine = await m.saveDashboardLayout(null, 'Mon suivi', [widget()])
    await m.setDefaultDashboardLayout(mine.key)
    await m.duplicateDashboardLayout(mine.key)
    await m.exportDashboardConfig(mine.key, 'd.json')
    await m.importDashboardConfig('d.json')
    expect((await m.getStartupDashboard()).key).toBe(mine.key)
  })
})
