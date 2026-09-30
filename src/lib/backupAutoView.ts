/**
 * Lot 32 : affichage de la sauvegarde automatique, sans aucune règle métier (tout est décidé par
 * pulse-core / `backup_auto`) : textes des codes `backup:…`, chemin raccourci, taille, bannière.
 */
import type { Messages } from '../i18n'
import type { AutoBackupStatus } from '../types/backupAuto'
import { formatDateTime } from './format'

const NB = '\u00a0'

/** Code d'une erreur `backup:<code>` (message d'erreur Tauri ou `Error`), sinon `null`. */
export function backupErrorCode(e: unknown): string | null {
  const text = String(e instanceof Error ? e.message : e)
  return /^backup:([A-Za-z]+)$/.exec(text.trim())?.[1] ?? null
}

/** Texte en clair d'un code (`diskFull`) ou d'une erreur (`backup:diskFull`, autre message). */
export function backupErrorText(t: Messages, codeOrError: unknown): string {
  const b = t.backupAuto
  const code = typeof codeOrError === 'string' && /^[A-Za-z]+$/.test(codeOrError) ? codeOrError : backupErrorCode(codeOrError)
  if (code && b.errors[code]) return b.errors[code]
  return b.unknownError(String(codeOrError instanceof Error ? codeOrError.message : codeOrError))
}

/** Chemin coupé au milieu par « … » (le début dit le lecteur, la fin le dossier) ; entier s'il tient. */
export function middleEllipsis(path: string, max = 52): string {
  const chars = [...path]
  if (chars.length <= max) return path
  const keep = max - 1
  const head = Math.ceil(keep * 0.45)
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - (keep - head)).join('')}`
}

/** « 512 o », « 48 Ko », « 1,4 Mo », « 2,1 Go » (espace insécable, virgule décimale). */
export function formatSize(t: Messages, bytes: number): string {
  const u = t.backupAuto.units
  if (bytes < 1024) return `${bytes}${NB}${u.b}`
  const steps: [number, string][] = [[1024 ** 3, u.gb], [1024 ** 2, u.mb], [1024, u.kb]]
  const [div, unit] = steps.find(([d]) => bytes >= d) ?? steps[2]
  const v = bytes / div
  const digits = v >= 100 || unit === u.kb ? 0 : 1
  return `${v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: digits }).replace(/\s/g, NB)}${NB}${unit}`
}

/** « Prochaine prévue » : date, ou « au prochain contrôle » si elle est déjà atteinte. */
export function nextDueText(t: Messages, status: AutoBackupStatus, now: number): string {
  const b = t.backupAuto
  if (status.nextDueAt === null) return b.notScheduled
  return status.nextDueAt <= now ? b.nextSoon : formatDateTime(status.nextDueAt)
}

export type BackupBanner =
  | { kind: 'invite' }
  | { kind: 'stale'; days: number | null; cause: string | null }

/**
 * Bannière de la coque : « dernière sauvegarde ancienne » (décidée par pulse-core : `stale`), sinon
 * l'invitation. Aucune sur la page Paramètres (le panneau dit la même chose), ni une fois masquée.
 */
export function bannerFor(
  status: AutoBackupStatus | null,
  opts: { onSettings: boolean; dismissedStale: boolean },
): BackupBanner | null {
  if (!status || opts.onSettings) return null
  if (status.stale && !opts.dismissedStale) {
    const cause = status.lastFailed && status.lastError ? status.lastError : null
    return { kind: 'stale', days: status.lastSuccessAt === null ? null : status.daysSinceSuccess, cause }
  }
  if (status.invite) return { kind: 'invite' }
  return null
}

/** Nombre de sauvegardes gardées saisi : entier de 1 à `max`, sinon `null`. */
export function parseKeep(input: string, max: number): number | null {
  const s = input.trim()
  if (!/^\d{1,3}$/.test(s)) return null
  const n = Number(s)
  return n >= 1 && n <= max ? n : null
}
