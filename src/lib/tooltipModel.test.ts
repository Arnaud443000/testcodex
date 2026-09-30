import { describe, expect, it } from 'vitest'
import { hasContent, placeTooltip } from './tooltipModel'

const view = { width: 1000, height: 700 }
const tip = { width: 200, height: 40 }

describe('placeTooltip', () => {
  it('se place au-dessus, centrée sur la cible', () => {
    const p = placeTooltip({ left: 400, top: 300, width: 40, height: 20 }, tip, view)
    expect(p.side).toBe('top')
    expect(p.left).toBe(420 - 100)
    expect(p.top).toBe(300 - 8 - 40)
    expect(p.arrowLeft).toBe(100)
  })
  it('passe en dessous s’il n’y a pas de place en haut', () => {
    const p = placeTooltip({ left: 400, top: 10, width: 40, height: 20 }, tip, view)
    expect(p.side).toBe('bottom')
    expect(p.top).toBe(10 + 20 + 8)
  })
  it('reste au-dessus quand ni le haut ni le bas ne suffit, si le haut est le plus grand', () => {
    const p = placeTooltip({ left: 10, top: 60, width: 20, height: 20 }, { width: 100, height: 120 }, { width: 400, height: 140 })
    expect(p.side).toBe('top')
    expect(p.top).toBeGreaterThanOrEqual(8)
  })
  it('ne dépasse jamais les bords de la fenêtre et la flèche suit la cible', () => {
    const left = placeTooltip({ left: 0, top: 300, width: 20, height: 20 }, tip, view)
    expect(left.left).toBe(8)
    expect(left.arrowLeft).toBe(12) // 10 - 8 = 2, ramenée à 12
    const right = placeTooltip({ left: 980, top: 300, width: 20, height: 20 }, tip, view)
    expect(right.left).toBe(1000 - 200 - 8)
    expect(right.arrowLeft).toBe(188) // centre de la cible à 198 px, ramené à 12 px du bord droit
  })
  it('contenu vide : pas d’infobulle', () => {
    expect(hasContent(undefined)).toBe(false)
    expect(hasContent(null)).toBe(false)
    expect(hasContent(false)).toBe(false)
    expect(hasContent('  ')).toBe(false)
    expect(hasContent('Taux de réussite')).toBe(true)
    expect(hasContent(0)).toBe(true)
  })
})
