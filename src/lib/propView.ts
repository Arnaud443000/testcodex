import type { Messages } from '../i18n'
import type { PropLevel } from '../types/prop'
import type { Account } from '../types/account'
import type { Decimal } from '../types/money'
import { signOf } from './decimal'
import { formatMoney } from './format'

/**
 * Suivi prop firm (lot 33) : affichage pur, aucun calcul métier. Les niveaux, montants, pourcentages
 * et heures de Paris viennent de pulse-core ; ici on formate seulement.
 */

const NBSP = ' '

/**
 * Part utilisée d'une limite : « 69,9 % ». Tronquée au dixième (jamais arrondie vers le haut) :
 * 99,9998 % s'affiche « 99,9 % », pas « 100,0 % » alors que la limite n'est pas atteinte.
 */
export function formatUsedPercent(used: number | null | undefined): string {
  if (used === null || used === undefined) return '—'
  const tenths = Math.floor(used * 1000 + 1e-9)
  const value = (tenths / 10).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return `${value.replace('-', '−')}${NBSP}%`
}

/** Largeur de la barre d'une jauge, bornée à [0 ; 100] % (le texte, lui, dit la vraie valeur). */
export function gaugeWidth(used: number | null | undefined): number {
  if (used === null || used === undefined || Number.isNaN(used)) return 0
  return Math.max(0, Math.min(100, used * 100))
}

/** Compte à rebours « 3 h 12 min », « 45 min », « < 1 min » (espaces insécables). */
export function formatCountdown(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return `<${NBSP}1${NBSP}min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}${NBSP}min`
  return m === 0 ? `${h}${NBSP}h` : `${h}${NBSP}h${NBSP}${m}${NBSP}min`
}

/** Jour « AAAA-MM-JJ » en « 15/09/2026 ». */
export function formatDayKey(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : day
}

/** Libellé du niveau (en texte : jamais la couleur seule). Cohérence « atteinte » = « Règle dépassée ». */
export function levelLabel(t: Messages, level: PropLevel | null, consistency = false): string {
  if (level === null) return t.prop.undefinedLevel
  if (consistency && level === 'reached') return t.prop.consistencyReached
  return t.prop.levels[level]
}

/** Ton de la jauge (classes de la charte), toujours accompagné du texte et de l'icône. */
export function levelTone(level: PropLevel | null): 'neutral' | 'ok' | 'warn' | 'bad' {
  if (level === null) return 'neutral'
  return level === 'ok' ? 'ok' : level === 'warning' ? 'warn' : 'bad'
}

/** Icône du niveau. */
export function levelIcon(level: PropLevel | null): 'check' | 'alert' | 'info' {
  if (level === null) return 'info'
  return level === 'ok' ? 'check' : 'alert'
}

/** `invalid input: prop:percentOutOfRange:maxLoss` → { code, field }. */
export function parsePropError(e: unknown): { code: string; field: string | null } | null {
  const text = String(e instanceof Error ? e.message : e)
  const m = /prop:([A-Za-z]+)(?::([A-Za-z]+))?/.exec(text)
  return m ? { code: m[1], field: m[2] ?? null } : null
}

/** Texte traduit d'un refus de pulse-core (qui fait foi) ; message brut s'il n'est pas codé. */
export function propErrorText(t: Messages, e: unknown): string {
  const x = t.prop.errors
  const p = parsePropError(e)
  const text = p ? x.codes[p.code] : undefined
  if (!p || !text) return String(e instanceof Error ? e.message : e)
  const field = p.field ? x.fields[p.field] : undefined
  return field ? x.withField(text, field) : text
}

/** « Reste 1 500,00 $ », « Dépassée de 500,00 $ » (montant arrondi au centime à l'affichage seulement), « — » sans limite. */
export function remainingText(t: Messages, remaining: Decimal | null, currency: string): string {
  if (remaining === null) return '—'
  return signOf(remaining) < 0 ? t.prop.exceededBy(formatMoney(remaining.replace(/^-/, ''), currency)) : t.prop.remaining(formatMoney(remaining, currency))
}

/**
 * Compte lu par le widget « Prop firm » parmi les comptes de sa portée (widget, puis dashboard, puis barre du haut) :
 * le seul compte prop de la portée ; `notProp` si la portée est un seul compte qui n'est pas prop ; `none` sinon
 * (aucun ou plusieurs comptes prop : rien n'est deviné).
 */
export function widgetPropAccount(chosen: Pick<Account, 'id' | 'kind'>[]): number | 'none' | 'notProp' {
  const props = chosen.filter((a) => a.kind === 'prop')
  if (props.length === 1) return props[0].id
  if (chosen.length === 1) return 'notProp'
  return 'none'
}
