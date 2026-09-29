import type { CardModel, CardOptions, CardOutcome, TradeCardFigures } from '../types/tradeCard'
import type { TradeView } from '../types/trade'
import { formatDate, formatPercent, formatR, formatSignedMoney } from './format'

/**
 * Carte de trade (lot 24, cahier 3.7.7) : SÉLECTION des éléments et FORMATS. Aucun calcul :
 * R, rendement en % et P&L viennent de pulse-core (`get_trade_card_figures`), ici on ne fait que
 * choisir ce qui apparaît et le mettre en forme. Rien de sensible par défaut.
 */

export const CARD_BRAND = 'Pulse'

/** Dimensions du PNG (px). */
export const CARD_SIZES = { portrait: { width: 1080, height: 1350 }, square: { width: 1080, height: 1080 } } as const

/** Vie privée par défaut : ni capture, ni argent, ni texte libre. */
export const DEFAULT_CARD_OPTIONS: CardOptions = {
  format: 'portrait',
  symbol: true,
  direction: true,
  resultR: true,
  resultPct: true,
  setup: true,
  date: true,
  screenshot: false,
  pnlMoney: false,
  thesis: false,
  postMortem: false,
}

/** Au-delà, l'affichage devient « > +999 R » : le chiffre exact ne tiendrait pas sur la carte. */
const R_LIMIT = 999
const PCT_LIMIT = 999
const MINUS = '−'

/** « +2,1 R » ; « — » sans R ; « > +999 R » / « < −999 R » pour un R hors norme (jamais de coupure au milieu d'un nombre). */
export function cardR(r: number | null): string {
  if (r === null || !Number.isFinite(r)) return '—'
  if (Math.abs(r) > R_LIMIT) return r > 0 ? `> +${R_LIMIT}\u00a0R` : `< ${MINUS}${R_LIMIT}\u00a0R`
  return formatR(r, Math.abs(r) >= 100 ? 0 : 1)
}

/** Rendement signé : « +1,2 % » ; « — » quand il n'est pas défini (trade ouvert, solde non positif). Arrondi avant le signe : jamais « −0,0 % ». */
export function cardPct(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return '—'
  const v = fraction * 100
  if (Math.abs(v) > PCT_LIMIT) return v > 0 ? `> +${PCT_LIMIT}\u00a0%` : `< ${MINUS}${PCT_LIMIT}\u00a0%`
  const digits = Math.abs(v) >= 100 ? 0 : 1
  return formatPercent(Number(v.toFixed(digits)) + 0, digits)
}

export function cardOutcome(figures: TradeCardFigures): CardOutcome {
  return figures.closed && figures.outcome ? figures.outcome : 'open'
}

/** Textes fixes que le modèle porte (traduits par l'appelant depuis `fr.ts`). */
export interface CardLabels {
  directions: Record<'long' | 'short', string>
  outcomes: Record<CardOutcome, string>
}

/** Ce que la carte peut lire : le trade, le nom de son setup (déjà résolu) et les chiffres de pulse-core. */
export interface CardSource {
  trade: TradeView
  setupName: string | null
  figures: TradeCardFigures
}

/**
 * Construit le modèle. Une clé absente = un élément non affiché. On ne lit dans `trade` QUE le
 * symbole, le sens, les dates, la devise (seulement pour le montant coché), le texte des notes
 * (seulement si cochées) : ni compte, ni courtier, ni capital, ni solde.
 */
export function buildCardModel(src: CardSource, o: CardOptions, labels: CardLabels): CardModel {
  const { trade, figures } = src
  const model: CardModel = { format: o.format, brand: CARD_BRAND }
  if (o.symbol && trade.symbol.trim()) model.symbol = trade.symbol.trim()
  if (o.direction) model.direction = { side: trade.direction, label: labels.directions[trade.direction] }
  const outcome = cardOutcome(figures)
  if (o.resultR || o.resultPct) {
    model.result = { outcome, label: labels.outcomes[outcome] }
    if (o.resultR) model.result.r = cardR(figures.rMultiple)
    if (o.resultPct) model.result.pct = cardPct(figures.returnFraction)
  }
  if (o.pnlMoney && figures.closed && figures.netPnl !== null) {
    model.pnlMoney = { outcome, text: formatSignedMoney(figures.netPnl, trade.currency) }
  }
  if (o.setup && src.setupName?.trim()) model.setup = src.setupName.trim()
  if (o.date) model.date = formatDate(trade.exitTime ?? trade.entryTime)
  if (o.screenshot && trade.screenshotPath) model.screenshot = true
  if (o.thesis && trade.thesis.trim()) model.thesis = trade.thesis.trim()
  if (o.postMortem && trade.postMortem.trim()) model.postMortem = trade.postMortem.trim()
  return model
}

/** Nom de fichier proposé : « pulse-carte-EURUSD-2026-09-28.png » ; les caractères interdits sous Windows (`/ \ : * ? " < > |`) sont retirés. */
export function cardFileName(symbol: string, atMs: number): string {
  const safe = symbol.replace(/[^A-Za-z0-9._-]+/g, '').slice(0, 24) || 'trade'
  const d = new Date(atMs)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `pulse-carte-${safe}-${day}.png`
}

/** Informations lues dans l'en-tête d'un PNG (signature + bloc IHDR), sans le décoder. `null` si ce n'est pas un PNG. */
export function readPngInfo(bytes: Uint8Array): { width: number; height: number; bytes: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20), bytes: bytes.length }
}

/** Même plafond que pulse-core (`MAX_IMAGE_BYTES`). */
export const MAX_CARD_BYTES = 20 * 1024 * 1024
