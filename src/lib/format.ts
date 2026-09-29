import type { Decimal } from '../types/money'
import { roundDecimal, signOf, trimDecimal } from './decimal'

/** Formatage à la française : espace insécable fine comme séparateur de milliers, virgule décimale. */
const LOCALE = 'fr-FR'
const MINUS = '−' // vrai signe moins (charte 3)
const NBSP = ' '
const THIN_NBSP = ' ' // séparateur de milliers de Intl fr-FR

/**
 * Formate un décimal exact (chaîne renvoyée par pulse-core) sans passer par un
 * flottant : "12345.6" → "12 345,60" (minFractionDigits = 2). N'arrondit jamais :
 * les décimales en trop sont conservées. Signe moins typographique, jamais de « −0 ».
 * L'interface n'additionne jamais d'argent : elle affiche (cf. CLAUDE.md, « Argent et prix »).
 */
export function formatDecimal(value: Decimal, minFractionDigits = 0): string {
  const negative = value.startsWith('-')
  const [intPart, frac = ''] = (negative ? value.slice(1) : value).split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_NBSP)
  const fraction = frac.padEnd(minFractionDigits, '0')
  const body = fraction ? `${grouped},${fraction}` : grouped
  return negative && /[1-9]/.test(body) ? `${MINUS}${body}` : body
}

function money(abs: number, currency: string): string {
  return abs.toLocaleString(LOCALE, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** P&L signé : +1 234,50 $ / −80,00 $ (signe explicite, vrai signe moins). */
export function formatPnl(value: number, currency = 'USD'): string {
  const abs = money(Math.abs(value), currency)
  if (value > 0) return `+${abs}`
  if (value < 0) return `${MINUS}${abs}`
  return abs
}

/** Pourcentage signé avec une décimale : +8,4 % / −6,2 %. */
export function formatPercent(value: number, digits = 1): string {
  const abs = `${Math.abs(value).toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })}${NBSP}%`
  if (value > 0) return `+${abs}`
  if (value < 0) return `${MINUS}${abs}`
  return abs
}

const currencySymbols = new Map<string, string>()
function currencySymbol(currency: string): string {
  let s = currencySymbols.get(currency)
  if (s === undefined) {
    try {
      s = new Intl.NumberFormat(LOCALE, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
        .formatToParts(0)
        .find((p) => p.type === 'currency')?.value
    } catch {
      /* code de devise inconnu */
    }
    s ??= currency
    currencySymbols.set(currency, s)
  }
  return s
}

/**
 * Montant exact (chaîne de pulse-core) avec devise : « 341,60 $ ».
 * Lot 26 : **arrondi au centime à l'affichage seulement** (moitié éloignée de zéro, sur la chaîne, jamais via un
 * flottant) : un prix à 4 décimales multiplié par une taille donne des montants à 5 décimales, qui s'affichaient
 * « +213,453 $ » à côté de « −17,80 $ ». Exception : un montant non nul inférieur au centime (frais minuscules)
 * garde sa précision plutôt que de s'afficher « 0,00 ». La valeur exacte reste celle de pulse-core.
 */
export function formatMoney(value: Decimal, currency: string): string {
  const cents = roundDecimal(value, 2)
  const shown = /^-?0(\.0+)?$/.test(cents) && /[1-9]/.test(value) ? trimDecimal(value, 2) : cents
  return `${formatDecimal(shown, 2)}${NBSP}${currencySymbol(currency)}`
}

/** P&L exact signé : « +341,60 $ » / « −80,00 $ » (signe explicite, vrai signe moins, jamais « −0 »). */
export function formatSignedMoney(value: Decimal, currency: string): string {
  const s = signOf(value)
  const abs = formatMoney(s < 0 ? value.slice(1) : value, currency)
  return s > 0 ? `+${abs}` : s < 0 ? `${MINUS}${abs}` : abs
}

/** Multiple de risque : « +2,1 R » / « −1,0 R » ; « — » quand il n'est pas défini (pas de stop). */
export function formatR(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return '—'
  const abs = `${Math.abs(value).toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })}${NBSP}R`
  const rounded = Number(value.toFixed(digits))
  return rounded > 0 ? `+${abs}` : rounded < 0 ? `${MINUS}${abs}` : abs
}

/** Nombre non signé avec décimales fixes : « 2,6 ». */
export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return '—'
  return value.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** Durée : « 1 h 12 min », « 45 min », « 2 j 3 h », « < 1 min ». */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '< 1 min'
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return h > 0 ? `${d} j ${h} h` : `${d} j`
  if (h > 0) return m > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`
  return `${m} min`
}

/** Date et heure locales : « 28 sept. 2026 · 09:42 ». */
export function formatDateTime(ms: number): string {
  const d = new Date(ms)
  const date = d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${date} · ${time}`
}

/** Date locale courte : « 28 sept. 2026 ». */
export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Fraction renvoyée par pulse-core → pourcentage affiché : 0,584 → « 58,4 % » (non signé). */
export function formatRatioPercent(fraction: number | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined) return '—'
  return `${(fraction * 100).toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })}${NBSP}%`
}

/** Écart de taux en points de pourcentage : 0,032 → « +3,2 pts » ; « −0,5 pt ». */
export function formatPoints(fraction: number, digits = 1): string {
  const value = fraction * 100
  const rounded = Number(value.toFixed(digits))
  const abs = `${Math.abs(value).toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })}${NBSP}pt${Math.abs(rounded) >= 2 ? 's' : ''}`
  return rounded > 0 ? `+${abs}` : rounded < 0 ? `${MINUS}${abs}` : abs
}

/** Écart signé d'un ratio sans unité : « +0,12 » / « −0,10 ». */
export function formatSignedNumber(value: number, digits = 2): string {
  const rounded = Number(value.toFixed(digits))
  const abs = Math.abs(value).toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return rounded > 0 ? `+${abs}` : rounded < 0 ? `${MINUS}${abs}` : abs
}

/** Pourcentage signé d'une variation relative (0,5 → « +50,0 % »). */
export function formatSignedRatioPercent(fraction: number, digits = 1): string {
  return formatPercent(fraction * 100, digits)
}

/** Montant signé sans devise pour les petites cases du calendrier : « +1 038,5 » / « −602 » (arrondi au centime, lot 26). */
export function formatSignedAmount(value: Decimal): string {
  const s = signOf(value)
  const abs = formatDecimal(trimDecimal(roundDecimal(s < 0 ? value.slice(1) : value, 2), 0), 0)
  return s > 0 ? `+${abs}` : s < 0 ? `${MINUS}${abs}` : abs
}

/** Valeur dérivée (moyenne par trade…) : arrondie à 2 décimales pour l'affichage, signe explicite. */
export function formatSignedMoneyRounded(value: Decimal, currency: string): string {
  return formatSignedMoney(roundDecimal(value, 2), currency)
}
