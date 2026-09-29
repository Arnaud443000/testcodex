import { describe, expect, it } from 'vitest'
import { fr } from '../i18n/fr'
import { isNavActive, NAV, NAV_GROUPS, SETTINGS_ITEM } from './navigation'

/** Les 14 adresses de la barre latérale avant le lot 26 : le regroupement ne doit en perdre aucune (liens existants). */
const BEFORE = ['/', '/trades', '/calendar', '/analytics', '/comparisons', '/behavior', '/discipline', '/insights', '/journal', '/goals', '/replay', '/coach', '/sizing', '/settings']
const active = (path: string) => NAV.filter((i) => isNavActive(i, path)).map((i) => i.to)

describe('navigation regroupée (lot 26)', () => {
  it('garde exactement les mêmes destinations qu\'avant, chacune une seule fois', () => {
    const tos = NAV.map((i) => i.to)
    expect(new Set(tos).size).toBe(tos.length)
    expect([...tos].sort()).toEqual([...BEFORE].sort())
  })
  it('chaque entrée et chaque groupe a un libellé français', () => {
    for (const i of NAV) expect(fr.nav[i.key], i.to).toBeTruthy()
    for (const g of NAV_GROUPS) if (g.key) expect(fr.nav.groups[g.key], g.key).toBeTruthy()
  })
  it('l\'ordre est Saisir → Analyser → Comprendre → Outils, Paramètres en dernier et épinglé', () => {
    expect(NAV_GROUPS.map((g) => g.key)).toEqual([null, 'capture', 'analyse', 'understand', 'tools'])
    expect(NAV[NAV.length - 1]).toBe(SETTINGS_ITEM)
    expect(NAV_GROUPS.flatMap((g) => g.items)).not.toContain(SETTINGS_ITEM)
  })
  it('aucun groupe n\'est vide', () => {
    for (const g of NAV_GROUPS) expect(g.items.length).toBeGreaterThan(0)
  })
  it('une seule entrée est active à la fois, y compris sur les sous-pages', () => {
    expect(active('/')).toEqual(['/'])
    expect(active('/trades')).toEqual(['/trades'])
    expect(active('/trades/new')).toEqual(['/trades'])
    expect(active('/trades/12/edit')).toEqual(['/trades'])
    expect(active('/calendar/news')).toEqual(['/calendar'])
    expect(active('/analytics')).toEqual(['/analytics'])
  })
  it('l\'historique des alertes allume Paramètres ; une adresse inconnue n\'allume rien', () => {
    expect(active('/alerts')).toEqual(['/settings'])
    expect(active('/settings')).toEqual(['/settings'])
    expect(active('/nimporte-quoi')).toEqual([])
    expect(active('/tradesX')).toEqual([])
  })
})
