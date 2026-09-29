import { describe, expect, it } from 'vitest'
import rustSource from '../../crates/pulse-core/src/stats/trade_card.rs?raw'
import { trade } from './fixtures'
import {
  buildCardModel,
  cardFileName,
  cardPct,
  cardR,
  CARD_SIZES,
  DEFAULT_CARD_OPTIONS,
  MAX_CARD_BYTES,
  readPngInfo,
  type CardLabels,
} from './tradeCard'
import type { CardOptions, TradeCardFigures } from '../types/tradeCard'
import { fr } from '../i18n/fr'

const NB = ' '
const labels: CardLabels = { directions: fr.tradeCard.card.directions, outcomes: fr.tradeCard.card.outcomes }

const win: TradeCardFigures = { tradeId: 1, closed: true, outcome: 'win', rMultiple: 2.1, returnFraction: 0.0412, netPnl: '9876.54' }

/** Un trade bourré d'informations sensibles : rien de tout cela ne doit sortir par défaut. */
const secretTrade = trade({
  id: 1,
  symbol: 'EURUSD',
  accountName: 'Compte Secret Prop Firm',
  thesis: 'THÈSE SECRÈTE',
  postMortem: 'POST-MORTEM SECRET',
  screenshotPath: 'screenshots/x.png',
  initialRisk: '123.45',
  currency: 'CHF',
  fees: '6.40',
  entryTime: Date.UTC(2026, 8, 28, 9, 42),
  exitTime: Date.UTC(2026, 8, 28, 10, 54),
})
const src = (figures = win, over: Partial<typeof secretTrade> = {}) => ({ trade: { ...secretTrade, ...over }, setupName: 'Breakout NY', figures })
const on = (o: Partial<CardOptions>): CardOptions => ({ ...DEFAULT_CARD_OPTIONS, ...o })

describe('vie privée par défaut (3.7.7)', () => {
  it('les options par défaut : ni capture, ni argent, ni texte libre', () => {
    const o = DEFAULT_CARD_OPTIONS
    expect([o.screenshot, o.pnlMoney, o.thesis, o.postMortem]).toEqual([false, false, false, false])
    expect([o.symbol, o.direction, o.resultR, o.resultPct, o.setup, o.date]).toEqual([true, true, true, true, true, true])
  })

  it("le modèle par défaut ne contient AUCUN champ interdit (ni clé, ni valeur)", () => {
    const model = buildCardModel(src(), DEFAULT_CARD_OPTIONS, labels)
    const allowed = ['format', 'brand', 'symbol', 'direction', 'result', 'setup', 'date']
    expect(Object.keys(model).sort()).toEqual([...allowed].sort())
    const forbiddenKeys = /capital|balance|solde|account|compte|broker|courtier|currency|devise|netPnl|pnlMoney|fees|frais|thesis|postMortem|screenshot|note|initialRisk|risk/i
    const keys: string[] = []
    const walk = (v: unknown) => {
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (keys.push(k), walk(x))
    }
    walk(model)
    expect(keys.filter((k) => forbiddenKeys.test(k))).toEqual([])
    const json = JSON.stringify(model)
    for (const secret of ['Compte Secret', 'THÈSE', 'POST-MORTEM', 'screenshots/', '9876', '9 876', '123,45', '123.45', 'CHF', '€', '6,40', '10000']) {
      expect(json).not.toContain(secret)
    }
    // Le résultat reste lisible : R et % signés, et un libellé (pas la couleur seule).
    expect(model.result).toEqual({ outcome: 'win', label: 'Gain', r: `+2,1${NB}R`, pct: `+4,1${NB}%` })
  })

  it("chaque élément sensible n'apparaît que s'il est coché", () => {
    expect(buildCardModel(src(), on({ pnlMoney: true }), labels).pnlMoney).toEqual({ outcome: 'win', text: `+9${' '}876,54${NB}CHF` })
    expect(buildCardModel(src(), on({ thesis: true }), labels).thesis).toBe('THÈSE SECRÈTE')
    expect(buildCardModel(src(), on({ postMortem: true }), labels).postMortem).toBe('POST-MORTEM SECRET')
    expect(buildCardModel(src(), on({ screenshot: true }), labels).screenshot).toBe(true)
    // Même tout coché : jamais de compte, de solde ni de courtier.
    const all = JSON.stringify(buildCardModel(src(), on({ pnlMoney: true, thesis: true, postMortem: true, screenshot: true }), labels))
    expect(all).not.toContain('Compte Secret')
    expect(all).not.toMatch(/balance|solde|broker/i)
  })

  it('un élément décoché disparaît, et une donnée absente ne crée pas de clé', () => {
    const none = buildCardModel(src(), on({ symbol: false, direction: false, resultR: false, resultPct: false, setup: false, date: false }), labels)
    expect(Object.keys(none).sort()).toEqual(['brand', 'format'])
    const noSetup = buildCardModel({ ...src(), setupName: '  ' }, DEFAULT_CARD_OPTIONS, labels)
    expect('setup' in noSetup).toBe(false)
    const noShot = buildCardModel(src(win, { screenshotPath: null }), on({ screenshot: true, thesis: true }), labels)
    expect('screenshot' in noShot).toBe(false)
    const blank = buildCardModel(src(win, { thesis: '  \n ' }), on({ thesis: true }), labels)
    expect('thesis' in blank).toBe(false)
  })

  it("« Résultat en R » seul : le pourcentage n'est pas dans le modèle", () => {
    const m = buildCardModel(src(), on({ resultPct: false }), labels)
    expect(m.result).toEqual({ outcome: 'win', label: 'Gain', r: `+2,1${NB}R` })
  })
})

describe('formats', () => {
  it('R : signe explicite, vrai signe moins, « — » sans valeur', () => {
    expect(cardR(2.1)).toBe(`+2,1${NB}R`)
    expect(cardR(-1.04)).toBe(`−1,0${NB}R`)
    expect(cardR(0)).toBe(`0,0${NB}R`)
    expect(cardR(-0.04)).toBe(`0,0${NB}R`) // arrondi à zéro : jamais « −0,0 R »
    expect(cardR(null)).toBe('—')
    expect(cardR(Number.NaN)).toBe('—')
  })

  it('R très grand ou très négatif : plafonné, jamais coupé au milieu', () => {
    expect(cardR(123.4)).toBe(`+123${NB}R`)
    expect(cardR(999)).toBe(`+999${NB}R`)
    expect(cardR(1234.5)).toBe(`> +999${NB}R`)
    expect(cardR(-5000)).toBe(`< −999${NB}R`)
  })

  it('% : rendement signé arrondi avant le signe', () => {
    expect(cardPct(0.012)).toBe(`+1,2${NB}%`)
    expect(cardPct(-0.0625)).toBe(`−6,3${NB}%`)
    expect(cardPct(0.5)).toBe(`+50,0${NB}%`)
    expect(cardPct(1.234)).toBe(`+123${NB}%`)
    expect(cardPct(-0.0004)).toBe(`0,0${NB}%`)
    expect(cardPct(12.5)).toBe(`> +999${NB}%`)
    expect(cardPct(null)).toBe('—')
  })

  it('trade ouvert : « — » partout, libellé « Trade en cours », pas de P&L même coché', () => {
    const open: TradeCardFigures = { tradeId: 1, closed: false, outcome: null, rMultiple: null, returnFraction: null, netPnl: null }
    const m = buildCardModel(src(open, { exitTime: null, figures: null }), on({ pnlMoney: true }), labels)
    expect(m.result).toEqual({ outcome: 'open', label: 'Trade en cours', r: '—', pct: '—' })
    expect('pnlMoney' in m).toBe(false)
    expect(m.date).toBeTruthy() // la date d'entrée
  })

  it('sans stop : R « — » mais le % existe', () => {
    const m = buildCardModel(src({ ...win, rMultiple: null }), DEFAULT_CARD_OPTIONS, labels)
    expect(m.result?.r).toBe('—')
    expect(m.result?.pct).toBe(`+4,1${NB}%`)
  })

  it('perte et breakeven : libellé et signe', () => {
    const loss = buildCardModel(src({ ...win, outcome: 'loss', rMultiple: -1, returnFraction: -0.01, netPnl: '-100' }), on({ pnlMoney: true }), labels)
    expect(loss.result).toEqual({ outcome: 'loss', label: 'Perte', r: `−1,0${NB}R`, pct: `−1,0${NB}%` })
    expect(loss.pnlMoney?.text).toBe(`−100,00${NB}CHF`)
    const be = buildCardModel(src({ ...win, outcome: 'breakeven', rMultiple: 0, returnFraction: 0, netPnl: '0' }), DEFAULT_CARD_OPTIONS, labels)
    expect(be.result).toEqual({ outcome: 'breakeven', label: 'À l’équilibre', r: `0,0${NB}R`, pct: `0,0${NB}%` })
  })

  it('symbole très long : gardé entier dans le modèle (le dessin l’ajuste), espaces retirés', () => {
    const long = 'A'.repeat(80)
    expect(buildCardModel(src(win, { symbol: `  ${long} ` }), DEFAULT_CARD_OPTIONS, labels).symbol).toBe(long)
  })

  it('la date est celle de la sortie (entrée pour un trade ouvert)', () => {
    const closed = buildCardModel(src(win, { exitTime: Date.UTC(2026, 8, 29, 12) }), DEFAULT_CARD_OPTIONS, labels).date
    expect(closed).toContain('29')
  })
})

describe('fichier', () => {
  it('nom proposé : sans caractère interdit sous Windows', () => {
    expect(cardFileName('EURUSD', Date.UTC(2026, 8, 28, 12))).toBe('pulse-carte-EURUSD-2026-09-28.png')
    expect(cardFileName('BTC/USD:perp*?', Date.UTC(2026, 8, 28, 12))).toBe('pulse-carte-BTCUSDperp-2026-09-28.png')
    expect(cardFileName('///', Date.UTC(2026, 8, 28, 12))).toContain('-trade-')
    expect(cardFileName('X'.repeat(200), 0).length).toBeLessThan(60)
  })

  it('tailles : 1080 × 1350 et 1080 × 1080', () => {
    expect(CARD_SIZES.portrait).toEqual({ width: 1080, height: 1350 })
    expect(CARD_SIZES.square).toEqual({ width: 1080, height: 1080 })
  })

  it("lit l'en-tête d'un PNG (dimensions, taille) et refuse le reste", () => {
    const png = new Uint8Array(33)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const view = new DataView(png.buffer)
    view.setUint32(16, 1080)
    view.setUint32(20, 1350)
    expect(readPngInfo(png)).toEqual({ width: 1080, height: 1350, bytes: 33 })
    expect(readPngInfo(new Uint8Array(40))).toBeNull()
    expect(readPngInfo(new Uint8Array(5))).toBeNull()
  })

  it('le plafond de taille est celui de pulse-core (20 Mo)', () => {
    expect(rustSource).toContain('MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024')
    expect(MAX_CARD_BYTES).toBe(20 * 1024 * 1024)
  })
})
