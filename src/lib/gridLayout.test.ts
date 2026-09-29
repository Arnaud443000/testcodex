import { describe, expect, it } from 'vitest'
import { addAt, cellAt, cellDelta, firstFreeSpot, moveTo, overlaps, readingOrder, resizeTo, rowCount, settle, type Box } from './gridLayout'

const COLS = 30
const b = (uid: string, x: number, y: number, w: number, h: number): Box => ({ uid, x, y, w, h })
const noOverlap = (items: Box[]) => items.every((a, i) => items.slice(i + 1).every((c) => !overlaps(a, c)))
const at = (items: Box[], uid: string) => items.find((i) => i.uid === uid)!

describe('settle', () => {
  it('ne change rien à une disposition déjà valide et compacte', () => {
    const layout = [b('a', 0, 0, 10, 5), b('b', 10, 0, 20, 5), b('c', 0, 5, 30, 4)]
    expect(settle(layout)).toEqual(layout)
  })

  it('fait remonter les widgets pour boucher un vide', () => {
    const out = settle([b('a', 0, 0, 10, 5), b('b', 0, 9, 10, 5)])
    expect(at(out, 'b').y).toBe(5)
  })

  it('pousse vers le bas les widgets gênés par le widget prioritaire', () => {
    const out = settle([b('a', 0, 0, 10, 5), b('b', 0, 5, 10, 5), b('mv', 0, 0, 10, 4)], 'mv')
    expect(at(out, 'mv').y).toBe(0)
    expect(at(out, 'a').y).toBe(4)
    expect(at(out, 'b').y).toBe(9)
    expect(noOverlap(out)).toBe(true)
  })

  it('résout une disposition chevauchante sans jamais laisser de chevauchement', () => {
    const out = settle([b('a', 0, 0, 10, 5), b('b', 5, 2, 10, 5), b('c', 8, 3, 10, 5), b('d', 20, 0, 10, 5)])
    expect(noOverlap(out)).toBe(true)
  })

  it('garde l’ordre des éléments en entrée', () => {
    const out = settle([b('z', 0, 3, 5, 5), b('a', 0, 0, 5, 5)])
    expect(out.map((i) => i.uid)).toEqual(['z', 'a'])
  })
})

describe('moveTo', () => {
  const layout = [b('a', 0, 0, 10, 6), b('b', 10, 0, 10, 6), b('c', 0, 6, 20, 6)]

  it('déplace à la position demandée quand la place est libre', () => {
    const out = moveTo(layout, 'b', 20, 0, COLS)
    expect(at(out, 'b')).toMatchObject({ x: 20, y: 0 })
    expect(noOverlap(out)).toBe(true)
  })

  it('borne le déplacement à la grille', () => {
    const out = moveTo(layout, 'b', 99, -5, COLS)
    expect(at(out, 'b').x).toBe(20) // 30 − largeur 10
    expect(at(out, 'b').y).toBe(0)
  })

  it('échange de place : le widget déposé sur un autre le pousse vers le bas', () => {
    const out = moveTo(layout, 'c', 0, 0, COLS)
    expect(at(out, 'c')).toMatchObject({ x: 0, y: 0 })
    expect(at(out, 'a').y).toBeGreaterThanOrEqual(6)
    expect(noOverlap(out)).toBe(true)
  })

  it('un widget lâché dans le vide remonte jusqu’au premier obstacle', () => {
    const out = moveTo(layout, 'b', 10, 40, COLS)
    expect(at(out, 'b').y).toBe(12) // c (colonnes 0–20, lignes 6–12) le retient : rien ne reste en l’air
    expect(at(out, 'c').y).toBe(6)
    expect(moveTo(layout, 'b', 20, 40, COLS).find((i) => i.uid === 'b')!.y).toBe(0)
  })

  it('ne modifie pas la disposition d’origine', () => {
    const copy = JSON.parse(JSON.stringify(layout))
    moveTo(layout, 'a', 5, 5, COLS)
    expect(layout).toEqual(copy)
  })
})

describe('resizeTo', () => {
  const layout = [b('a', 0, 0, 10, 6), b('b', 10, 0, 10, 6), b('c', 0, 6, 20, 6)]
  const min = { w: 5, h: 4 }

  it('agrandit et pousse les voisins', () => {
    const out = resizeTo(layout, 'a', 15, 6, min, COLS)
    expect(at(out, 'a')).toMatchObject({ w: 15, h: 6 })
    expect(noOverlap(out)).toBe(true)
    expect(at(out, 'b').y).toBeGreaterThan(0)
  })

  it('respecte le minimum et le bord droit', () => {
    expect(at(resizeTo(layout, 'a', 1, 1, min, COLS), 'a')).toMatchObject({ w: 5, h: 4 })
    expect(at(resizeTo(layout, 'b', 50, 6, min, COLS), 'b').w).toBe(20) // x = 10, grille de 30
  })

  it('rétrécir laisse remonter les widgets du dessous', () => {
    const out = resizeTo(layout, 'a', 10, 4, min, COLS)
    expect(at(out, 'c').y).toBe(6) // b garde 6 lignes de haut
    const out2 = resizeTo([b('a', 0, 0, 10, 6), b('c', 0, 6, 10, 4)], 'a', 10, 4, min, COLS)
    expect(at(out2, 'c').y).toBe(4)
  })
})

describe('placement', () => {
  it('trouve la première place libre', () => {
    const items = [b('a', 0, 0, 10, 6), b('b', 20, 0, 10, 6)]
    expect(firstFreeSpot(items, 10, 6, COLS)).toEqual({ x: 10, y: 0 })
    expect(firstFreeSpot(items, 15, 6, COLS)).toEqual({ x: 0, y: 6 })
    expect(firstFreeSpot([], 6, 6, COLS)).toEqual({ x: 0, y: 0 })
  })

  it('ajoute sans chevauchement', () => {
    const out = addAt([b('a', 0, 0, 30, 6)], { uid: 'n', w: 10, h: 5 }, COLS)
    expect(at(out, 'n')).toMatchObject({ x: 0, y: 6 })
    expect(noOverlap(out)).toBe(true)
  })

  it('compte les lignes et donne l’ordre de lecture', () => {
    const items = [b('b', 10, 0, 5, 5), b('c', 0, 5, 5, 5), b('a', 0, 0, 5, 5)]
    expect(rowCount(items)).toBe(10)
    expect(readingOrder(items).map((i) => i.uid)).toEqual(['a', 'b', 'c'])
  })
})

describe('conversions écran → grille', () => {
  const grid = { left: 100, top: 50, width: 900 } // 30 colonnes de 30 px
  it('donne la case sous un point', () => {
    expect(cellAt(100, 50, grid, COLS, 28)).toEqual({ col: 0, row: 0 })
    expect(cellAt(100 + 30 * 5 + 1, 50 + 28 * 3 + 5, grid, COLS, 28)).toEqual({ col: 5, row: 3 })
  })
  it('convertit un déplacement en cases (arrondi au plus proche)', () => {
    expect(cellDelta(44, 13, 900, COLS, 28)).toEqual({ dCols: 1, dRows: 0 })
    expect(cellDelta(-46, 15, 900, COLS, 28)).toEqual({ dCols: -2, dRows: 1 })
  })
})
