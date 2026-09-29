import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { fr } from '../../i18n/fr'
import { createDashboardsMock } from '../../lib/mockDashboards'
import type { ScopeEnv } from '../../lib/widgetScope'
import type { WidgetInstance } from '../../types/dashboardLayout'
import type { Account } from '../../types/account'
import { WidgetHost } from './WidgetHost'
import { WIDGET_COMPONENTS } from './widgets'

const account = (id: number, currency: string): Account =>
  ({ id, name: `Compte ${id}`, kind: 'personal', broker: '', currency, initialCapital: '1000', archived: false, hasHistory: false }) as Account

const env = (accounts: Account[]): ScopeEnv => ({
  accounts,
  allAccounts: accounts,
  selectedId: null,
  period: '3M',
  nowMs: Date.UTC(2026, 8, 29, 12),
  tzOffsetMin: 0,
})
const instance = (kind: string, over: Partial<WidgetInstance> = {}): WidgetInstance => ({
  uid: 'x', kind, x: 0, y: 0, w: 10, h: 10, period: null, accountId: null, mode: null, ...over,
})
const html = (i: WidgetInstance, e: ScopeEnv) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(WidgetHost, { instance: i, env: e })))

describe('bibliothèque de widgets', () => {
  it('chaque widget de pulse-core a un composant et des textes', async () => {
    const catalog = await createDashboardsMock(async () => []).listWidgetCatalog()
    expect(Object.keys(WIDGET_COMPONENTS).sort()).toEqual(catalog.map((d) => d.kind).sort())
    for (const d of catalog) {
      const w = fr.dashboardBuilder.widgets[d.kind]
      expect(w?.title, d.kind).toBeTruthy()
      expect(w?.description, d.kind).toBeTruthy()
      expect(fr.dashboardBuilder.categories[d.category], d.kind).toBeTruthy()
      for (const m of d.modes) expect(fr.dashboardBuilder.modes[d.kind]?.[m], `${d.kind}/${m}`).toBeTruthy()
    }
  })

  it('un widget inconnu (venu d’une version future) affiche un message au lieu de planter', () => {
    expect(html(instance('brand_new'), env([account(1, 'USD')]))).toContain(fr.dashboardBuilder.unknownWidget)
  })

  it('devises mélangées : chaque widget lié à des comptes explique pourquoi il est vide', async () => {
    const catalog = await createDashboardsMock(async () => []).listWidgetCatalog()
    const mixed = env([account(1, 'USD'), account(2, 'EUR')])
    // Les insights évaluent chaque compte seul (chacun avec sa devise) : aucune somme, donc aucun blocage.
    for (const d of catalog.filter((c) => c.kind !== 'insights')) {
      const out = html(instance(d.kind), mixed)
      expect(out, d.kind).toContain(fr.dashboardBuilder.mixedCurrencies)
      expect(out, d.kind).toContain(fr.dashboardBuilder.widgets[d.kind].title)
    }
  })

  it('insights : le widget ne bloque pas sur des devises mélangées et n’a pas de période propre', async () => {
    const catalog = await createDashboardsMock(async () => []).listWidgetCatalog()
    const d = catalog.find((c) => c.kind === 'insights')!
    expect([d.period, d.account, d.modes]).toEqual([false, true, []])
    const out = html(instance('insights'), env([account(1, 'USD'), account(2, 'EUR')]))
    expect(out).not.toContain(fr.dashboardBuilder.mixedCurrencies)
    expect(out).toContain(fr.dashboardBuilder.widgets.insights.title)
  })

  it('compte fixé qui a disparu : message clair, jamais de chiffres de tous les comptes', async () => {
    const catalog = await createDashboardsMock(async () => []).listWidgetCatalog()
    for (const d of catalog.filter((c) => c.account)) {
      expect(html(instance(d.kind, { accountId: 42 }), env([account(1, 'USD')])), d.kind).toContain(fr.dashboardBuilder.accountGone)
    }
  })

  it('une période ou un compte propres sont signalés sur le widget', () => {
    const out = html(instance('kpi', { period: '1W', mode: 'win_rate' }), env([account(1, 'USD'), account(2, 'EUR')]))
    expect(out).toContain(fr.dashboardBuilder.ownPeriodTag('1 semaine'))
  })
})
