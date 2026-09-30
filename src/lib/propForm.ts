import type { LimitMode, PropRules, PropRulesInput } from '../types/prop'
import { compareDecimal, isPlainDecimal, normalizeDecimalInput } from './decimal'

/**
 * Éditeur des règles prop firm (lot 33) : état du formulaire et contrôles de forme, purs et testés.
 * Ces contrôles évitent un aller-retour ; **pulse-core valide à nouveau et fait foi** (codes `prop:…`).
 * Rien n'est deviné : l'heure et le fuseau de remise à zéro doivent être saisis.
 */

export interface LimitForm {
  enabled: boolean
  mode: LimitMode
  value: string
}

export interface PropForm {
  phaseLabel: string
  startedOn: string
  resetTime: string
  /** '' = pas encore choisi (obligatoire). */
  resetZone: '' | 'paris' | 'newYork'
  dailyLoss: LimitForm
  dailyReference: 'initialBalance' | 'dayStartBalance'
  maxLoss: LimitForm
  maxLossKind: 'static' | 'trailing'
  trailingLocksAtInitial: boolean
  profitTarget: LimitForm
  minTradingDays: string
  consistency: string
}

export type PropFormField = 'startedOn' | 'resetTime' | 'resetZone' | 'dailyLoss' | 'maxLoss' | 'profitTarget' | 'minTradingDays' | 'consistency' | 'phaseLabel'
/** Clé du message d'erreur (`fr.prop.errors`). */
export type PropFormError = 'required' | 'number' | 'percent' | 'amount' | 'day' | 'time' | 'wholeDays'

const off = (): LimitForm => ({ enabled: false, mode: 'percent', value: '' })

/** Formulaire vierge : seul le début du défi est proposé (aujourd'hui) ; aucune règle n'est pré-remplie. */
export function emptyPropForm(today: string): PropForm {
  return {
    phaseLabel: '',
    startedOn: today,
    resetTime: '',
    resetZone: '',
    dailyLoss: off(),
    dailyReference: 'initialBalance',
    maxLoss: off(),
    maxLossKind: 'static',
    trailingLocksAtInitial: false,
    profitTarget: off(),
    minTradingDays: '',
    consistency: '',
  }
}

/** Décimal enregistré → saisie à la française (« 2.5 » → « 2,5 »). */
const toInput = (v: string) => v.replace('.', ',')

export function formFromRules(r: PropRules): PropForm {
  const lim = (l: PropRules['dailyLoss']): LimitForm => (l ? { enabled: true, mode: l.mode, value: toInput(l.value) } : off())
  return {
    phaseLabel: r.phaseLabel ?? '',
    startedOn: r.startedOn,
    resetTime: r.resetTime,
    resetZone: r.resetZone,
    dailyLoss: lim(r.dailyLoss),
    dailyReference: r.dailyReference,
    maxLoss: lim(r.maxLoss),
    maxLossKind: r.maxLossKind,
    trailingLocksAtInitial: r.trailingLocksAtInitial,
    profitTarget: lim(r.profitTarget),
    minTradingDays: r.minTradingDays === null ? '' : String(r.minTradingDays),
    consistency: r.consistencyMaxBestDayPercent === null ? '' : toInput(r.consistencyMaxBestDayPercent),
  }
}

/** « 9:00 », « 9h30 » et « 09:00 » acceptés, normalisés en « HH:MM » ; `null` sinon. */
export function normalizeTime(input: string): string | null {
  const m = /^(\d{1,2})\s*[:h]\s*(\d{2})$/i.exec(input.trim())
  if (!m) return null
  const [h, mi] = [Number(m[1]), Number(m[2])]
  return h < 24 && mi < 60 ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : null
}

const isDay = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

/** Un pourcentage : > 0 et ≤ 100 (comparaison exacte, sans flottant). */
function percentProblem(v: string): PropFormError | null {
  if (!isPlainDecimal(v, { allowNegative: true })) return 'number'
  return compareDecimal(v, '0') <= 0 || compareDecimal(v, '100') > 0 ? 'percent' : null
}

function limitProblem(l: LimitForm): [string | null, PropFormError | null] {
  const v = normalizeDecimalInput(l.value)
  if (v === '') return [null, 'required']
  if (l.mode === 'percent') {
    const p = percentProblem(v)
    return p ? [null, p] : [v, null]
  }
  if (!isPlainDecimal(v, { allowNegative: true })) return [null, 'number']
  return compareDecimal(v, '0') <= 0 ? [null, 'amount'] : [v, null]
}

/** Contrôle le formulaire ; renvoie la saisie pour pulse-core, ou les erreurs par champ. */
export function buildPropInput(f: PropForm): { input: PropRulesInput | null; errors: Partial<Record<PropFormField, PropFormError>> } {
  const errors: Partial<Record<PropFormField, PropFormError>> = {}
  if (!f.startedOn.trim()) errors.startedOn = 'required'
  else if (!isDay(f.startedOn.trim())) errors.startedOn = 'day'
  const time = normalizeTime(f.resetTime)
  if (!f.resetTime.trim()) errors.resetTime = 'required'
  else if (!time) errors.resetTime = 'time'
  if (!f.resetZone) errors.resetZone = 'required'

  const limits: Record<'dailyLoss' | 'maxLoss' | 'profitTarget', { mode: string; value: string } | null> = { dailyLoss: null, maxLoss: null, profitTarget: null }
  for (const key of ['dailyLoss', 'maxLoss', 'profitTarget'] as const) {
    if (!f[key].enabled) continue
    const [value, problem] = limitProblem(f[key])
    if (problem) errors[key] = problem
    else limits[key] = { mode: f[key].mode, value: value! }
  }

  let minTradingDays: number | null = null
  const days = f.minTradingDays.trim()
  if (days) {
    if (!/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 1000) errors.minTradingDays = 'wholeDays'
    else minTradingDays = Number(days)
  }
  let consistency: string | null = null
  const c = normalizeDecimalInput(f.consistency)
  if (c) {
    const p = percentProblem(c)
    if (p) errors.consistency = p
    else consistency = c
  }
  if (Object.keys(errors).length > 0) return { input: null, errors }
  return {
    input: {
      phaseLabel: f.phaseLabel.trim() || null,
      startedOn: f.startedOn.trim(),
      dailyLoss: limits.dailyLoss,
      dailyReference: f.dailyReference,
      maxLoss: limits.maxLoss,
      maxLossKind: f.maxLossKind,
      trailingLocksAtInitial: f.maxLossKind === 'trailing' && f.trailingLocksAtInitial,
      resetTime: time!,
      resetZone: f.resetZone,
      profitTarget: limits.profitTarget,
      minTradingDays,
      consistencyMaxBestDayPercent: consistency,
    },
    errors,
  }
}

/** Compte choisi sur la page : celui de la barre du haut s'il est prop, sinon le premier compte prop. */
export function pickPropAccount(propIds: number[], selectedId: number | null, remembered: number | null): number | null {
  if (remembered !== null && propIds.includes(remembered)) return remembered
  if (selectedId !== null && propIds.includes(selectedId)) return selectedId
  return propIds[0] ?? null
}
