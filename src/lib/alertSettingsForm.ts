import type { AlertSettings } from '../types/alerts'
import type { BehaviorSettings } from '../types/behavior'
import { compareDecimal, isPlainDecimal, normalizeDecimalInput } from './decimal'

/**
 * Formulaire des seuils d'alerte (Paramètres > Alertes, cahier 3.6.7). Ne fait que lire la saisie et la
 * contrôler : les seuils sont validés une seconde fois, et font foi, dans pulse-core (`alerts::set_settings`,
 * `settings::set_behavior`). Aucun calcul métier ici.
 *
 * Règle commune : un champ vide vaut « alerte désactivée » ; un interrupteur éteint aussi.
 */

/** Les neuf alertes, dans l'ordre du cahier (3.6.1 à 3.6.6). */
export const ALERT_KEYS = [
  'consecutiveLosses',
  'tradesPerDay',
  'tradesPerWindow',
  'dailyLoss',
  'weeklyLoss',
  'revenge',
  'outsideHours',
  'unusualSession',
  'noStopLoss',
] as const
export type AlertKey = (typeof ALERT_KEYS)[number]

/** Défauts de pulse-core (`alerts::settings`), affichés à côté des champs. Un test les compare au mock. */
export const ALERT_DEFAULTS = {
  consecutiveLosses: '3',
  burstMaxTrades: '3',
  burstWindowMin: '60',
  dailyLossPercent: '3',
  weeklyLossPercent: '6',
  revengeWindowMin: '60',
  revengeSizeFactor: '1,5',
} as const

/** Champs de saisie (tous du texte : la saisie est lue à la française, sans passer par un `number`). */
export interface AlertFormValues {
  consecutiveLosses: string
  /** Limite quotidienne : réglage COMMUN avec le score de discipline. */
  maxTradesPerDay: string
  burstMaxTrades: string
  burstWindowMin: string
  dailyLossPercent: string
  dailyLossAmount: string
  weeklyLossPercent: string
  weeklyLossAmount: string
  /** Définition de la revanche : réglages COMMUNS avec le score de discipline. */
  revengeWindowMin: string
  revengeSizeFactor: string
  hoursStart: string
  hoursEnd: string
}
export type AlertField = keyof AlertFormValues

export interface AlertForm {
  enabled: Record<AlertKey, boolean>
  values: AlertFormValues
}

export type AlertFormErrors = Partial<Record<AlertField, true>>

/** Champs qui portent le seuil de chaque alerte : tous vides (ou interrupteur éteint) = alerte désactivée. */
export const THRESHOLD_FIELDS: Partial<Record<AlertKey, AlertField[]>> = {
  consecutiveLosses: ['consecutiveLosses'],
  tradesPerDay: ['maxTradesPerDay'],
  tradesPerWindow: ['burstMaxTrades'],
  dailyLoss: ['dailyLossPercent', 'dailyLossAmount'],
  weeklyLoss: ['weeklyLossPercent', 'weeklyLossAmount'],
  outsideHours: ['hoursStart', 'hoursEnd'],
}

/** Valeur mise dans le champ quand on rallume une alerte dont le seuil est vide. */
const RESTORE: Partial<Record<AlertKey, Partial<AlertFormValues>>> = {
  consecutiveLosses: { consecutiveLosses: ALERT_DEFAULTS.consecutiveLosses },
  tradesPerDay: { maxTradesPerDay: '3' },
  tradesPerWindow: { burstMaxTrades: ALERT_DEFAULTS.burstMaxTrades },
  dailyLoss: { dailyLossPercent: ALERT_DEFAULTS.dailyLossPercent },
  weeklyLoss: { weeklyLossPercent: ALERT_DEFAULTS.weeklyLossPercent },
  outsideHours: { hoursStart: '09:00', hoursEnd: '17:00' },
}

/** Décimal exact vers champ : « 1.5 » → « 1,5 ». */
const toField = (v: string) => v.replace('.', ',')
const numField = (n: number | null) => (n === null ? '' : String(n))

/** Plage « HH:MM-HH:MM » → [début, fin] pour les deux champs (vide si absente). */
function splitHours(hours: string | null): [string, string] {
  const m = hours === null ? null : /^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/.exec(hours)
  return m ? [m[1], m[2]] : ['', '']
}

export function formFromSettings(alerts: AlertSettings, behavior: BehaviorSettings): AlertForm {
  const [hoursStart, hoursEnd] = splitHours(alerts.tradingHours)
  const enabled: Record<AlertKey, boolean> = {
    consecutiveLosses: alerts.consecutiveLosses !== null,
    tradesPerDay: behavior.maxTradesPerDay !== null,
    tradesPerWindow: alerts.burstMaxTrades !== null,
    dailyLoss: alerts.dailyLossPercent !== null || alerts.dailyLossAmount !== null,
    weeklyLoss: alerts.weeklyLossPercent !== null || alerts.weeklyLossAmount !== null,
    revenge: alerts.revenge,
    outsideHours: alerts.tradingHours !== null,
    unusualSession: alerts.unusualSession,
    noStopLoss: alerts.noStopLoss,
  }
  return {
    enabled,
    values: {
      consecutiveLosses: numField(alerts.consecutiveLosses),
      maxTradesPerDay: numField(behavior.maxTradesPerDay),
      burstMaxTrades: numField(alerts.burstMaxTrades),
      burstWindowMin: String(alerts.burstWindowMin),
      dailyLossPercent: alerts.dailyLossPercent === null ? '' : toField(alerts.dailyLossPercent),
      dailyLossAmount: alerts.dailyLossAmount === null ? '' : toField(alerts.dailyLossAmount),
      weeklyLossPercent: alerts.weeklyLossPercent === null ? '' : toField(alerts.weeklyLossPercent),
      weeklyLossAmount: alerts.weeklyLossAmount === null ? '' : toField(alerts.weeklyLossAmount),
      revengeWindowMin: String(behavior.revengeWindowMin),
      revengeSizeFactor: toField(behavior.revengeSizeFactor),
      hoursStart,
      hoursEnd,
    },
  }
}

/** Valeurs par défaut de pulse-core (limite quotidienne, seuils en argent et plage horaire désactivés). */
export const DEFAULT_ALERT_FORM: AlertForm = {
  enabled: {
    consecutiveLosses: true,
    tradesPerDay: false,
    tradesPerWindow: true,
    dailyLoss: true,
    weeklyLoss: true,
    revenge: true,
    outsideHours: false,
    unusualSession: true,
    noStopLoss: true,
  },
  values: {
    consecutiveLosses: ALERT_DEFAULTS.consecutiveLosses,
    maxTradesPerDay: '',
    burstMaxTrades: ALERT_DEFAULTS.burstMaxTrades,
    burstWindowMin: ALERT_DEFAULTS.burstWindowMin,
    dailyLossPercent: ALERT_DEFAULTS.dailyLossPercent,
    dailyLossAmount: '',
    weeklyLossPercent: ALERT_DEFAULTS.weeklyLossPercent,
    weeklyLossAmount: '',
    revengeWindowMin: ALERT_DEFAULTS.revengeWindowMin,
    revengeSizeFactor: ALERT_DEFAULTS.revengeSizeFactor,
    hoursStart: '',
    hoursEnd: '',
  },
}

/** Allume ou éteint une alerte. Rallumer une alerte au seuil vide y remet une valeur de départ. */
export function setEnabled(form: AlertForm, key: AlertKey, on: boolean): AlertForm {
  const fields = THRESHOLD_FIELDS[key]
  const empty = fields !== undefined && fields.every((f) => form.values[f].trim() === '')
  return {
    enabled: { ...form.enabled, [key]: on },
    values: on && empty ? { ...form.values, ...RESTORE[key] } : form.values,
  }
}

/** Modifie un champ. Vider tous les champs de seuil d'une alerte l'éteint ; y saisir quelque chose la rallume. */
export function setValue(form: AlertForm, field: AlertField, value: string): AlertForm {
  const values = { ...form.values, [field]: value }
  const enabled = { ...form.enabled }
  for (const key of ALERT_KEYS) {
    const fields = THRESHOLD_FIELDS[key]
    if (!fields?.includes(field)) continue
    enabled[key] = fields.some((f) => values[f].trim() !== '')
  }
  return { enabled, values }
}

const wholeNumber = (input: string): number | null => {
  const s = input.trim()
  return /^\d{1,6}$/.test(s) ? Number(s) : null
}

/** Heure « 9:00 » ou « 09h30 » → « 09:00 » ; `null` si ce n'est pas une heure valide. */
export function normalizeTime(input: string): string | null {
  const m = /^(\d{1,2})\s*[:h]\s*(\d{2})$/i.exec(input.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** Pourcentage de perte : décimal > 0 et ≤ 100 (« 2,5 »). Vide → `null` sans erreur. */
function percent(input: string): { value: string | null; bad: boolean } {
  if (input.trim() === '') return { value: null, bad: false }
  const v = normalizeDecimalInput(input)
  if (!isPlainDecimal(v) || compareDecimal(v, '0') <= 0 || compareDecimal(v, '100') > 0) return { value: null, bad: true }
  return { value: v, bad: false }
}

/** Montant de perte : décimal > 0 (« 1 500,50 »). Vide → `null` sans erreur. */
function amount(input: string): { value: string | null; bad: boolean } {
  if (input.trim() === '') return { value: null, bad: false }
  const v = normalizeDecimalInput(input)
  if (!isPlainDecimal(v) || compareDecimal(v, '0') <= 0) return { value: null, bad: true }
  return { value: v, bad: false }
}

export interface ParsedAlertForm {
  alerts: AlertSettings
  behavior: Pick<BehaviorSettings, 'maxTradesPerDay' | 'revengeWindowMin' | 'revengeSizeFactor'>
}

/**
 * Lit le formulaire. Un interrupteur éteint ou un champ de seuil vide donne `null` (alerte désactivée) et
 * n'est pas contrôlé : seules les valeurs d'alertes allumées sont validées. Les bornes sont celles de pulse-core.
 */
export function parseAlertForm(form: AlertForm): { settings: ParsedAlertForm } | { errors: AlertFormErrors } {
  const { enabled: on, values: v } = form
  const errors: AlertFormErrors = {}

  let consecutiveLosses: number | null = null
  if (on.consecutiveLosses && v.consecutiveLosses.trim() !== '') {
    const n = wholeNumber(v.consecutiveLosses)
    if (n === null || n < 2 || n > 20) errors.consecutiveLosses = true
    else consecutiveLosses = n
  }

  let maxTradesPerDay: number | null = null
  if (on.tradesPerDay && v.maxTradesPerDay.trim() !== '') {
    const n = wholeNumber(v.maxTradesPerDay)
    if (n === null || n < 1) errors.maxTradesPerDay = true
    else maxTradesPerDay = n
  }

  let burstMaxTrades: number | null = null
  if (on.tradesPerWindow && v.burstMaxTrades.trim() !== '') {
    const n = wholeNumber(v.burstMaxTrades)
    if (n === null || n < 1 || n > 100) errors.burstMaxTrades = true
    else burstMaxTrades = n
  }
  // La durée de la fenêtre est toujours enregistrée, même quand l'alerte est éteinte : on la contrôle donc toujours.
  const burstWindowMin = wholeNumber(v.burstWindowMin)
  if (burstWindowMin === null || burstWindowMin < 1 || burstWindowMin > 1440) errors.burstWindowMin = true

  const loss = (enabledKey: 'dailyLoss' | 'weeklyLoss', pctField: AlertField, amtField: AlertField) => {
    if (!on[enabledKey]) return { pct: null, amt: null }
    const pct = percent(v[pctField])
    const amt = amount(v[amtField])
    if (pct.bad) errors[pctField] = true
    if (amt.bad) errors[amtField] = true
    return { pct: pct.value, amt: amt.value }
  }
  const daily = loss('dailyLoss', 'dailyLossPercent', 'dailyLossAmount')
  const weekly = loss('weeklyLoss', 'weeklyLossPercent', 'weeklyLossAmount')

  // La définition de la revanche est toujours enregistrée (elle sert aussi au score) : toujours contrôlée.
  const revengeWindowMin = wholeNumber(v.revengeWindowMin)
  if (revengeWindowMin === null || revengeWindowMin < 1 || revengeWindowMin > 1440) errors.revengeWindowMin = true
  const factor = normalizeDecimalInput(v.revengeSizeFactor)
  if (!isPlainDecimal(factor) || compareDecimal(factor, '1') < 0 || compareDecimal(factor, '1000') > 0) errors.revengeSizeFactor = true

  let tradingHours: string | null = null
  if (on.outsideHours && (v.hoursStart.trim() !== '' || v.hoursEnd.trim() !== '')) {
    const start = normalizeTime(v.hoursStart)
    const end = normalizeTime(v.hoursEnd)
    if (start === null) errors.hoursStart = true
    if (end === null) errors.hoursEnd = true
    // Début = fin n'a pas de sens (plage vide ou 24 h) : refusé, comme dans pulse-core.
    if (start !== null && end !== null) {
      if (start === end) errors.hoursEnd = true
      else tradingHours = `${start}-${end}`
    }
  }

  if (Object.keys(errors).length > 0) return { errors }
  return {
    settings: {
      alerts: {
        consecutiveLosses,
        burstMaxTrades,
        burstWindowMin: burstWindowMin as number,
        dailyLossPercent: daily.pct,
        dailyLossAmount: daily.amt,
        weeklyLossPercent: weekly.pct,
        weeklyLossAmount: weekly.amt,
        revenge: on.revenge,
        tradingHours,
        unusualSession: on.unusualSession,
        noStopLoss: on.noStopLoss,
      },
      behavior: { maxTradesPerDay, revengeWindowMin: revengeWindowMin as number, revengeSizeFactor: factor },
    },
  }
}
