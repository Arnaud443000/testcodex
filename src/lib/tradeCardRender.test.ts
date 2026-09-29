import { describe, expect, it } from 'vitest'
import tailwindSource from '../../tailwind.config.js?raw'
import {
  CARD_TOKENS,
  ellipsize,
  fitText,
  planCard,
  tabularWidth,
  wrapText,
  type Measure,
  type PlanLabels,
} from './tradeCardRender'
import { buildCardModel, DEFAULT_CARD_OPTIONS, type CardLabels } from './tradeCard'
import { trade } from './fixtures'
import { fr } from '../i18n/fr'
import type { CardOptions, TradeCardFigures } from '../types/tradeCard'

/** Faux `measureText` : chaque caractère fait 0,55 fois la taille de la police, sauf « 1 » (0,3) et « . » « , » « — » : proportionnel, comme Inter. */
const measure: Measure = (text, font) => {
  const size = Number(/(\d+)px/.exec(font)?.[1] ?? 16)
  let w = 0
  for (const ch of text) w += size * (ch === '1' ? 0.3 : '.,: '.includes(ch) ? 0.3 : 0.55)
  return w
}
const labels: PlanLabels = { setup: 'Setup', thesis: 'Thèse d’entrée', postMortem: 'Post-mortem', pnlCaption: 'P&L net' }
const cardLabels: CardLabels = { directions: fr.tradeCard.card.directions, outcomes: fr.tradeCard.card.outcomes }
const figures: TradeCardFigures = { tradeId: 1, closed: true, outcome: 'win', rMultiple: 2.1, returnFraction: 0.0412, netPnl: '412' }
const model = (o: Partial<CardOptions> = {}, t: Partial<ReturnType<typeof trade>> = {}, f = figures) =>
  buildCardModel({ trade: trade({ id: 1, screenshotPath: 'screenshots/a.png', ...t }), setupName: 'Breakout NY', figures: f }, { ...DEFAULT_CARD_OPTIONS, ...o }, cardLabels)

describe('texte', () => {
  it("ellipsize : coupe avec « … » et respecte la largeur", () => {
    const font = '400 40px Inter'
    const out = ellipsize(measure, 'A'.repeat(100), font, 300)
    expect(out.endsWith('…')).toBe(true)
    expect(measure(out, font)).toBeLessThanOrEqual(300)
    expect(ellipsize(measure, 'court', font, 300)).toBe('court')
  })

  it('fitText : réduit la police puis coupe un symbole démesuré', () => {
    expect(fitText(measure, 'EURUSD', 600, 150, 56, 936)).toEqual({ text: 'EURUSD', size: 150 })
    const mid = fitText(measure, 'ABCDEFGHIJKLMNOP', 600, 150, 56, 936)
    expect(mid.size).toBeLessThan(150)
    expect(mid.size).toBeGreaterThanOrEqual(56)
    expect(mid.text).toBe('ABCDEFGHIJKLMNOP')
    const huge = fitText(measure, 'X'.repeat(120), 600, 150, 56, 936)
    expect(huge.size).toBe(56)
    expect(huge.text.endsWith('…')).toBe(true)
  })

  it('wrapText : retours à la ligne, limite de lignes, mots géants coupés', () => {
    const font = '400 32px Inter'
    const w = wrapText(measure, 'un deux trois quatre cinq six sept huit neuf dix', font, 300, 10)
    expect(w.truncated).toBe(false)
    expect(w.lines.every((l) => measure(l, font) <= 300)).toBe(true)
    expect(w.lines.join(' ')).toBe('un deux trois quatre cinq six sept huit neuf dix')
    const cut = wrapText(measure, 'mot '.repeat(200), font, 300, 3)
    expect(cut.lines).toHaveLength(3)
    expect(cut.truncated).toBe(true)
    expect(cut.lines[2].endsWith('…')).toBe(true)
    expect(cut.lines.every((l) => measure(l, font) <= 300)).toBe(true)
    const giant = wrapText(measure, 'https://' + 'x'.repeat(200), font, 300, 20)
    expect(giant.lines.every((l) => measure(l, font) <= 300)).toBe(true)
    expect(giant.lines.join('')).toBe('https://' + 'x'.repeat(200))
    expect(wrapText(measure, 'a\n\nb', font, 300, 5).lines).toEqual(['a', '', 'b'])
  })

  it('chiffres tabulaires : « 1111 » et « 0000 » ont la même largeur', () => {
    const font = '700 100px Inter'
    expect(measure('1111', font)).not.toBe(measure('0000', font))
    expect(tabularWidth(measure, '1111', font)).toBe(tabularWidth(measure, '0000', font))
    expect(tabularWidth(measure, '+2,1 R', font)).toBeGreaterThan(0)
  })
})

describe('mise en page', () => {
  it('portrait par défaut : tout tient dans 1080 × 1350, sans capture ni texte', () => {
    const p = planCard(measure, model(), labels)
    expect([p.width, p.height]).toEqual([1080, 1350])
    expect(p.symbol?.text).toBe('EURUSD')
    expect(p.direction?.label).toBe('ACHAT')
    expect(p.result?.r?.text).toContain('R')
    expect(p.setup?.name.text).toBe('Breakout NY')
    expect(p.screenshot).toBeUndefined()
    expect(p.texts).toEqual([])
    const bottom = Math.max(p.result!.panel.y + p.result!.panel.h, p.setup!.box.y + p.setup!.box.h)
    expect(bottom).toBeLessThan(p.brand.baseline - 40)
  })

  it('carré : tient aussi, même avec un symbole très long et un R hors norme', () => {
    const p = planCard(measure, model({ format: 'square' }, { symbol: 'S'.repeat(90) }, { ...figures, rMultiple: -5000 }), labels)
    expect(p.height).toBe(1080)
    expect(p.symbol!.text.endsWith('…')).toBe(true)
    expect(p.result!.r!.text).toBe(`< −999${' '}R`)
    const bottom = Math.max(p.result!.panel.y + p.result!.panel.h, p.setup!.box.y + p.setup!.box.h)
    expect(bottom).toBeLessThan(p.brand.baseline - 40)
  })

  it('capture cochée : elle prend la place restante, dans les marges', () => {
    const p = planCard(measure, model({ screenshot: true }), labels)
    expect(p.screenshot).toBeDefined()
    const s = p.screenshot!
    expect(s.x).toBe(p.margin)
    expect(s.w).toBe(1080 - 2 * p.margin)
    expect(s.h).toBeGreaterThanOrEqual(260)
    expect(s.y + s.h).toBeLessThan(p.brand.baseline - 40)
    expect(p.screenshotNoRoom).toBe(false)
  })

  it('thèse très longue : raccourcie (…), signalée, et la capture reste affichée en portrait', () => {
    const p = planCard(measure, model({ screenshot: true, thesis: true }, { thesis: 'analyse '.repeat(500) }), labels)
    expect(p.truncated).toBe(true)
    expect(p.texts).toHaveLength(1)
    expect(p.texts[0].lines.length).toBeGreaterThanOrEqual(2)
    expect(p.texts[0].lines.at(-1)!.endsWith('…')).toBe(true)
    expect(p.screenshot).toBeDefined()
  })

  it('carré avec deux textes longs : la capture est omise ET signalée (jamais écrasée)', () => {
    const long = 'mot '.repeat(300)
    const p = planCard(measure, model({ format: 'square', screenshot: true, thesis: true, postMortem: true }, { thesis: long, postMortem: long }), labels)
    expect(p.screenshot).toBeUndefined()
    expect(p.screenshotNoRoom).toBe(true)
    expect(p.texts).toHaveLength(2)
  })

  it('trade ouvert : « — », pas de montant', () => {
    const open: TradeCardFigures = { tradeId: 1, closed: false, outcome: null, rMultiple: null, returnFraction: null, netPnl: null }
    const p = planCard(measure, model({ pnlMoney: true }, {}, open), labels)
    expect(p.result?.r?.text).toBe('—')
    expect(p.result?.pct?.text).toBe('—')
    expect(p.result?.pnl).toBeUndefined()
  })

  it('le P&L en argent n’est planifié que s’il est dans le modèle (coché)', () => {
    expect(planCard(measure, model(), labels).result?.pnl).toBeUndefined()
    expect(planCard(measure, model({ pnlMoney: true }), labels).result?.pnl?.text).toContain('412')
  })

  it("seuls R ou % cochés : la valeur unique est grande ; rien coché : pas de panneau", () => {
    const both = planCard(measure, model(), labels).result!
    const only = planCard(measure, model({ resultPct: false }), labels).result!
    expect(only.r!.size).toBeGreaterThan(both.r!.size)
    const none = planCard(measure, model({ resultR: false, resultPct: false }), labels)
    expect(none.result).toBeUndefined()
  })

  it('aucun élément : une carte vide avec la marque, sans planter', () => {
    const p = planCard(measure, model({ symbol: false, direction: false, resultR: false, resultPct: false, setup: false, date: false }), labels)
    expect(p.brand.text).toBe('Pulse')
    expect(p.texts).toEqual([])
  })
})

describe('aucun débordement, quelle que soit la combinaison', () => {
  const long = 'mot '.repeat(400)
  const bottoms = (p: ReturnType<typeof planCard>) => [
    p.result ? p.result.panel.y + p.result.panel.h : 0,
    p.setup ? p.setup.box.y + p.setup.box.h : 0,
    p.screenshot ? p.screenshot.y + p.screenshot.h : 0,
    ...p.texts.map((t) => t.box.y + t.box.h),
  ]
  const formats = ['portrait', 'square'] as const
  const flags = [false, true]
  for (const format of formats) {
    for (const screenshot of flags) {
      for (const thesis of flags) {
        for (const postMortem of flags) {
          for (const pnlMoney of flags) {
            it(`${format} capture=${screenshot} thèse=${thesis} post-mortem=${postMortem} argent=${pnlMoney}`, () => {
              const p = planCard(measure, model({ format, screenshot, thesis, postMortem, pnlMoney }, { thesis: long, postMortem: long }), labels)
              expect(Math.max(...bottoms(p))).toBeLessThanOrEqual(p.brand.baseline - 30)
              for (const t of p.texts) expect(t.lines.length).toBeGreaterThanOrEqual(1)
              // un texte retiré ou une capture omise est toujours signalé
              if (thesis && postMortem && p.texts.length < 2) expect(p.textsDropped).toBe(true)
              if (screenshot && !p.screenshot) expect(p.screenshotNoRoom).toBe(true)
              if (p.screenshot) expect(p.screenshot.h).toBeGreaterThanOrEqual(200)
            })
          }
        }
      }
    }
  }
})

describe('charte : tokens', () => {
  const colors: Record<string, string> = Object.fromEntries([...tailwindSource.matchAll(/'?([\w-]+)'?:\s*'(#[0-9A-Fa-f]{6})'/g)].map((m) => [m[1], m[2]]))
  it('les couleurs du canvas sont celles de tailwind.config.js', () => {
    const pairs: [keyof typeof CARD_TOKENS, string][] = [
      ['bgDeep', 'bg-deep'], ['bg', 'bg'], ['blue', 'blue'], ['violet', 'violet'], ['tx', 'tx'], ['tx2', 'tx2'], ['tx3', 'tx3'],
      ['txAccent', 'tx-accent'], ['gain', 'gain'], ['loss', 'loss'], ['neutral', 'neutral'],
    ]
    for (const [token, name] of pairs) expect(CARD_TOKENS[token].toLowerCase()).toBe(colors[name].toLowerCase())
  })
  it('les fonds de badge sont ceux de la charte (index.css)', async () => {
    // Lu avec fs : vitest ne rend pas le contenu d'un .css importé en `?raw`. Import dynamique, pour ne pas dépendre des types de Node.
    const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync: (p: string, e: string) => string }
    const css = fs.readFileSync('src/styles/index.css', 'utf8').toLowerCase()
    for (const c of [CARD_TOKENS.gainBg, CARD_TOKENS.lossBg, CARD_TOKENS.neutralBg]) expect(css).toContain(c.toLowerCase())
  })
})
