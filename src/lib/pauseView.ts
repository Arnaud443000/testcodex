import type { Alert } from '../types/alerts'
import {
  MAX_PAUSE_MINUTES,
  MIN_PAUSE_MINUTES,
  PAUSE_NOTE_MAX_CHARS,
  type NewPause,
  type PauseReason,
} from '../types/pause'

/**
 * Affichage de la pause volontaire (lot 35) : choix de la durée, contrôle de la saisie, libellés d'heure.
 * Logique pure, testée (`pauseView.test.ts`). Aucun calcul de statistique ici : tout vient de pulse-core,
 * qui refuse de toute façon une valeur hors bornes.
 */

const MIN = 60_000

/** Durées rapides proposées, en minutes ; « demain matin » et « autre » sont à part. */
export const QUICK_MINUTES = [15, 30, 60, 120] as const
export type LengthChoice = '15' | '30' | '60' | '120' | 'tomorrow' | 'custom'
export const LENGTH_CHOICES: LengthChoice[] = ['15', '30', '60', '120', 'tomorrow', 'custom']

/** Choix de départ : la durée par défaut des réglages, en durée rapide si elle en est une, sinon en durée libre. */
export function initialLength(defaultMinutes: number): { choice: LengthChoice; customText: string } {
  const quick = QUICK_MINUTES.find((m) => m === defaultMinutes)
  return quick ? { choice: String(quick) as LengthChoice, customText: '' } : { choice: 'custom', customText: String(defaultMinutes) }
}

/** Durée libre : un entier de 1 à 480 (espaces autour tolérés) ; tout le reste (« 1,5 », « 1e2 », « 0 », « 481 ») est refusé. */
export function parseCustomMinutes(text: string): number | null {
  const s = text.trim()
  if (!/^\d{1,4}$/.test(s)) return null
  const n = Number(s)
  return n >= MIN_PAUSE_MINUTES && n <= MAX_PAUSE_MINUTES ? n : null
}

export type BuiltPause = { ok: true; pause: NewPause } | { ok: false; error: 'customInvalid' }

/** Construit la demande envoyée à pulse-core ; le texte libre est rogné, vide = aucun. */
export function buildNewPause(input: { choice: LengthChoice; customText: string; reason: PauseReason | null; note: string; tzOffsetMin: number }): BuiltPause {
  const base = { reason: input.reason, note: input.note.trim().slice(0, PAUSE_NOTE_MAX_CHARS) || null, tzOffsetMin: input.tzOffsetMin }
  if (input.choice === 'tomorrow') return { ok: true, pause: { ...base, length: { kind: 'untilTomorrow' } } }
  const minutes = input.choice === 'custom' ? parseCustomMinutes(input.customText) : Number(input.choice)
  if (minutes === null) return { ok: false, error: 'customInvalid' }
  return { ok: true, pause: { ...base, length: { kind: 'minutes', minutes } } }
}

const pad = (n: number) => String(n).padStart(2, '0')
const localClock = (ms: number) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const localDayStart = (ms: number) => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Heure de fin à l'écran : « 15:40 » le même jour local, « demain 00:00 » sinon. */
export function endClock(endMs: number, nowMs: number): { time: string; tomorrow: boolean } {
  return { time: localClock(endMs), tomorrow: localDayStart(endMs) !== localDayStart(nowMs) }
}

/** Minutes restantes, arrondies au-dessus (1 jusqu'à la toute dernière milliseconde) ; 0 une fois la fin atteinte. */
export function remainingMinutes(plannedEndAt: number, nowMs: number): number {
  return Math.max(0, Math.ceil((plannedEndAt - nowMs) / MIN))
}

/** Une pause court tant que son heure de fin n'est pas atteinte (fin exclue, comme pulse-core). */
export const isRunning = (plannedEndAt: number, nowMs: number) => nowMs < plannedEndAt

/** Kinds d'alerte qui proposent « Faire une pause », et le motif présélectionné. */
export function pauseReasonForAlert(alert: Pick<Alert, 'kind'>): PauseReason | null {
  switch (alert.kind) {
    case 'consecutiveLosses':
      return 'lossStreak'
    case 'dailyLoss':
      return 'loss'
    case 'revenge':
      return 'emotion'
    default:
      return null
  }
}
export const alertOffersPause = (alert: Pick<Alert, 'kind'>) => pauseReasonForAlert(alert) !== null

/** Mot du verdict de pulse-core (`lower` / `similar` / `higher`) ; jamais une cause, jamais un ordre. */
export const verdictKey = (v: 'notEnoughData' | 'lower' | 'similar' | 'higher') => v
