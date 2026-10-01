import type { IconName } from '../components/Icon'
import type { Messages } from '../i18n'
import type { Decimal } from '../types/money'
import type { ProcessGoalProgress, ProcessMetric, ProcessPeriodKind, ProcessStatus } from '../types/processGoals'
import { compareDecimal, normalizeDecimalInput } from './decimal'
import { formatNumber } from './format'
import { formatMonthName } from './goalFormat'
import { dayString, lastDay, parsePeriod } from './processPeriods'

/**
 * Affichage des objectifs de comportement (lot 34) : libellés, statut en texte + icône, liens. Aucun calcul :
 * valeurs, statuts et séries viennent de pulse-core ; ici on formate et on choisit des mots.
 */

export const isRate = (m: ProcessMetric) => m === 'rules_respect_rate' || m === 'plan_follow_rate'
export const isCeiling = (m: ProcessMetric) => m === 'no_stop_trades' || m === 'overtrading_days' || m === 'revenge_trades' || m === 'risk_breaches'

/** Les trois objectifs types de l'état vide (un clic = créés tels quels). */
export function processTemplates(kind: ProcessPeriodKind): { metric: ProcessMetric; target: Decimal }[] {
  return [
    { metric: 'no_stop_trades', target: '0' },
    { metric: 'overtrading_days', target: kind === 'week' ? '1' : '3' },
    { metric: 'rules_respect_rate', target: '90' },
  ]
}

/** Statut : la forme de l'icône et le texte portent le sens, la couleur ne fait que le doubler. */
export function statusLook(s: ProcessStatus): { badge: string; icon: IconName } {
  switch (s) {
    case 'reached':
    case 'respected':
      return { badge: 'badge-gain', icon: 'check' }
    case 'respectedSoFar':
      return { badge: 'badge-neutral', icon: 'check' }
    case 'exceeded':
    case 'missed':
      return { badge: 'badge-loss', icon: 'cross' }
    case 'inProgress':
      return { badge: 'badge-warn', icon: 'right' }
    case 'settingRequired':
      return { badge: 'badge-neutral', icon: 'settings' }
    case 'noData':
      return { badge: 'badge-neutral', icon: 'minus' }
  }
}

/** « 90 » → « 90 % », « 90.5 » → « 90,5 % » (la cible telle que saisie, sans arrondi). */
export function percentText(target: Decimal): string {
  return `${target.replace('.', ',')} %`
}

/** L'objectif en une phrase : « Aucun trade sans stop », « Au moins 90 % de règles respectées »… */
export function goalSentence(t: Messages['processGoals'], metric: ProcessMetric, target: Decimal): string {
  const s = t.sentence
  switch (metric) {
    case 'rules_respect_rate':
    case 'plan_follow_rate':
      return s[metric](percentText(target))
    default:
      return s[metric](Number(target))
  }
}

/** « 90 % », « 66,7 % » : un taux renvoyé par pulse-core, arrondi à 0,1 pour l'affichage seulement. */
export function rateText(value: number): string {
  return `${formatNumber(value, 1).replace(/,0$/, '')} %`
}

/** La valeur réalisée, « — » quand pulse-core n'en donne pas. */
export function valueText(t: Messages['processGoals'], p: ProcessGoalProgress): string {
  if (p.value === null) return '—'
  if (p.unit === 'percent') return rateText(p.value)
  const count = t.count[p.goal.metric]
  return count ? count(p.value) : formatNumber(p.value, 0)
}

/** La cible, avec son unité : « 1 trade », « 90 % », « 5 jours ». */
export function targetText(t: Messages['processGoals'], metric: ProcessMetric, target: Decimal): string {
  if (isRate(metric)) return percentText(target)
  const count = t.count[metric]
  return count ? count(Number(target)) : target
}

/** Le détail d'un taux : « 9 coches respectées sur 10 ». */
export function ratioText(t: Messages['processGoals'], p: ProcessGoalProgress): string | null {
  if (p.numerator === null || p.denominator === null) return null
  return t.ratio[p.goal.metric]?.(p.numerator, p.denominator) ?? null
}

/** Titre de la période : « Semaine 38 » + « du 14 sept. au 20 sept. 2026 », ou « Septembre 2026 ». */
export function periodTitle(t: Messages['processGoals'], kind: ProcessPeriodKind, key: string): { title: string; range: string | null } {
  const p = parsePeriod(kind, key)
  if (!p) return { title: key, range: null }
  if (kind === 'month') {
    const name = formatMonthName(key)
    return { title: name.charAt(0).toUpperCase() + name.slice(1), range: null }
  }
  const date = (day: number, year: boolean) =>
    new Date(`${dayString(day)}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' })
  return { title: t.weekTitle(Number(key.slice(6))), range: t.weekRange(date(p.firstDay, false), date(lastDay(p), true)) }
}

/** Lecture de la cible saisie (à la française), avec les bornes de pulse-core ; pulse-core valide une seconde fois et fait foi. */
export type TargetError = 'empty' | 'notNumber' | 'count' | 'percent' | 'journalWeek' | 'journalMonth'
export function readTarget(kind: ProcessPeriodKind, metric: ProcessMetric, input: string): { target: Decimal } | { error: TargetError } {
  const s = normalizeDecimalInput(input)
  if (s === '') return { error: 'empty' }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { error: 'notNumber' }
  if (isRate(metric)) {
    return compareDecimal(s, '0') > 0 && compareDecimal(s, '100') <= 0 ? { target: s } : { error: 'percent' }
  }
  const whole = /^\d+(\.0+)?$/.test(s) ? BigInt(s.split('.')[0]) : null
  if (metric === 'journal_days') {
    const max = kind === 'week' ? 7n : 31n
    return whole !== null && whole >= 1n && whole <= max ? { target: whole.toString() } : { error: kind === 'week' ? 'journalWeek' : 'journalMonth' }
  }
  return whole !== null && whole <= 10_000n ? { target: whole.toString() } : { error: 'count' }
}
