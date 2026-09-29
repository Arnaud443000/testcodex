import { beforeEach, describe, expect, it } from 'vitest'
import { createDashboardsMock, ESSENTIAL, validateLayout } from './mockDashboards'
import type { WidgetInstance } from '../types/dashboardLayout'

const ids = [1, 2]
const mk = () => createDashboardsMock(async () => ids)
const widget = (over: Partial<WidgetInstance> = {}): WidgetInstance => ({
  uid: 'a', kind: 'capital', x: 0, y: 0, w: 10, h: 16, period: null, accountId: null, mode: null, ...over,
})

describe('faux backend des dashboards (miroir de pulse-core::dashboards)', () => {
  let m = mk()
  beforeEach(() => {
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
})
