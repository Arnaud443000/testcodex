import { describe, expect, it } from 'vitest'
import { addWidget, countByKind, newUid, patchWidget, removeWidget, sameLayout } from './dashboardDraft'
import { overlaps } from './gridLayout'
import { createDashboardsMock, ESSENTIAL, validateLayout } from './mockDashboards'
import type { WidgetDefinition, WidgetInstance } from '../types/dashboardLayout'

const mock = createDashboardsMock(async () => [{ id: 1, name: 'A', currency: 'USD', archived: false }])
const defs = async () => (await mock.listWidgetCatalog()) as WidgetDefinition[]

describe('brouillon de dashboard', () => {
  it('génère des identifiants uniques de 1 à 40 caractères', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const uid = newUid('long_kind_name_that_is_way_too_long_for_anything')
      expect(uid.length).toBeGreaterThan(0)
      expect(uid.length).toBeLessThanOrEqual(40)
      seen.add(uid)
    }
    expect(seen.size).toBe(200)
  })

  it('ajouter chaque widget de la bibliothèque à Essentiel donne toujours une disposition valide pour pulse-core', async () => {
    let items = (await mock.getDashboardLayout(ESSENTIAL)).widgets
    for (const d of await defs()) {
      items = addWidget(items, d)
      validateLayout(items, [1])
      const added = items[items.length - 1]
      expect(added.kind).toBe(d.kind)
      expect([added.w, added.h]).toEqual([d.defaultW, d.defaultH])
      expect(added.mode).toBe(d.modes[0] ?? null)
      expect(items.slice(0, -1).some((o) => overlaps(o, added))).toBe(false)
    }
  })

  it('retirer un widget le rend disponible : la bibliothèque le propose toujours', async () => {
    const before = (await mock.getDashboardLayout(ESSENTIAL)).widgets
    const after = removeWidget(before, 'calendar')
    expect(after).toHaveLength(before.length - 1)
    expect(countByKind(after).calendar).toBeUndefined()
    expect((await defs()).some((d) => d.kind === 'calendar')).toBe(true)
    expect(removeWidget(before, 'inconnu')).toEqual(before)
  })

  it('modifie les réglages d’un widget sans changer sa place', async () => {
    const items = (await mock.getDashboardLayout(ESSENTIAL)).widgets
    const out = patchWidget(items, 'kpi-win', { period: '1W', mode: 'profit_factor', accountId: 1 })
    const w = out.find((i) => i.uid === 'kpi-win') as WidgetInstance
    expect([w.period, w.mode, w.accountId, w.x, w.y]).toEqual(['1W', 'profit_factor', 1, 0, 16])
    expect(items.find((i) => i.uid === 'kpi-win')!.period).toBeNull()
    validateLayout(out, [1])
  })

  it('détecte les modifications non enregistrées, quel que soit l’ordre de la liste', async () => {
    const items = (await mock.getDashboardLayout(ESSENTIAL)).widgets
    expect(sameLayout(items, [...items].reverse())).toBe(true)
    expect(sameLayout(items, patchWidget(items, 'daily', { period: '1M' }))).toBe(false)
    expect(sameLayout(items, removeWidget(items, 'daily'))).toBe(false)
    expect(sameLayout(items, items.map((i) => (i.uid === 'daily' ? { ...i, x: i.x + 1 } : i)))).toBe(false)
  })

  it('compte les occurrences par type', async () => {
    const items = (await mock.getDashboardLayout(ESSENTIAL)).widgets
    expect(countByKind(items)).toMatchObject({ kpi: 5, calendar: 1, net_pnl_equity: 1 })
  })
})
