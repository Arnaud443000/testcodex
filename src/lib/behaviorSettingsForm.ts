import type { BehaviorSettings } from '../types/behavior'
import { compareDecimal, isPlainDecimal, normalizeDecimalInput } from './decimal'

/**
 * Formulaire des seuils de l'analyse (Paramètres). Ne fait que lire la saisie et la contrôler : les seuils
 * sont validés une seconde fois, et font foi, dans pulse-core (`settings::set_behavior`).
 */

/** Valeurs par défaut de pulse-core (`DEFAULT_REVENGE_WINDOW_MIN`, facteur 1,5), affichées à côté des champs. */
export const DEFAULT_REVENGE_WINDOW_MIN = 60
export const DEFAULT_REVENGE_SIZE_FACTOR = '1.5'

export interface BehaviorForm {
  maxRiskPercent: string
  maxTradesPerDay: string
  revengeWindowMin: string
  revengeSizeFactor: string
}

export type BehaviorFormField = keyof BehaviorForm
export type BehaviorFormErrors = Partial<Record<BehaviorFormField, true>>

/** Décimal exact vers champ de saisie : « 1.5 » → « 1,5 » (virgule française). */
const toField = (value: string) => value.replace('.', ',')

export function formFromSettings(s: BehaviorSettings): BehaviorForm {
  return {
    maxRiskPercent: s.maxRiskPercent === null ? '' : toField(s.maxRiskPercent),
    maxTradesPerDay: s.maxTradesPerDay === null ? '' : String(s.maxTradesPerDay),
    revengeWindowMin: String(s.revengeWindowMin),
    revengeSizeFactor: toField(s.revengeSizeFactor),
  }
}

/** Risque et surtrading désactivés, délai et facteur de revanche à leur valeur par défaut. */
export const DEFAULT_FORM: BehaviorForm = {
  maxRiskPercent: '',
  maxTradesPerDay: '',
  revengeWindowMin: String(DEFAULT_REVENGE_WINDOW_MIN),
  revengeSizeFactor: toField(DEFAULT_REVENGE_SIZE_FACTOR),
}

const wholeNumber = (input: string): number | null => {
  const s = input.trim()
  return /^\d{1,6}$/.test(s) ? Number(s) : null
}

/** Lit le formulaire. Un risque ou un nombre de trades vide = seuil désactivé (`null`). */
export function parseForm(form: BehaviorForm): { settings: BehaviorSettings } | { errors: BehaviorFormErrors } {
  const errors: BehaviorFormErrors = {}

  let maxRiskPercent: string | null = null
  if (form.maxRiskPercent.trim() !== '') {
    const v = normalizeDecimalInput(form.maxRiskPercent)
    if (!isPlainDecimal(v) || compareDecimal(v, '0') <= 0 || compareDecimal(v, '100') > 0) errors.maxRiskPercent = true
    else maxRiskPercent = v
  }

  let maxTradesPerDay: number | null = null
  if (form.maxTradesPerDay.trim() !== '') {
    const n = wholeNumber(form.maxTradesPerDay)
    if (n === null || n < 1) errors.maxTradesPerDay = true
    else maxTradesPerDay = n
  }

  const window = wholeNumber(form.revengeWindowMin)
  if (window === null || window < 1 || window > 1440) errors.revengeWindowMin = true

  const factor = normalizeDecimalInput(form.revengeSizeFactor)
  if (!isPlainDecimal(factor) || compareDecimal(factor, '1') < 0 || compareDecimal(factor, '1000') > 0) errors.revengeSizeFactor = true

  if (Object.keys(errors).length > 0) return { errors }
  return { settings: { maxRiskPercent, maxTradesPerDay, revengeWindowMin: window as number, revengeSizeFactor: factor } }
}
