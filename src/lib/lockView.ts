/**
 * Verrouillage (lot 22) : lecture des codes d'erreur `lock:…` renvoyés par pulse-core et contrôles
 * de saisie de l'interface. Aucune règle de sécurité ici : pulse-core refait tous les contrôles.
 */
import type { Messages } from '../i18n'

/** Choix proposés pour le verrouillage après inactivité (null = jamais, le défaut). */
export const IDLE_CHOICES: (number | null)[] = [null, 5, 10, 15, 30, 60]

/** Intervalle minimal entre deux signalements d'activité à la coque. */
export const TOUCH_INTERVAL_MS = 30_000

export interface LockErrorCode {
  code: string
  detail?: string
}

/** `lock:retryLater:5000` → { code: 'retryLater', detail: '5000' } ; autre chose → null. */
export function parseLockError(e: unknown): LockErrorCode | null {
  const text = String(e instanceof Error ? e.message : e)
  const m = /(?:^|\s)lock:([A-Za-z]+)(?::(\S+))?/.exec(text)
  return m ? { code: m[1], detail: m[2] } : null
}

export function isLockedError(e: unknown): boolean {
  return parseLockError(e)?.code === 'locked'
}

/** Délai d'attente contenu dans une erreur `retryLater`, en millisecondes. */
export function retryDelay(e: unknown): number | null {
  const p = parseLockError(e)
  if (p?.code !== 'retryLater') return null
  const ms = Number(p.detail)
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

/** Message traduit d'une erreur du verrou (ou message brut pour une autre erreur). */
export function lockErrorText(t: Messages, e: unknown, minChars = 8): string {
  const p = parseLockError(e)
  const x = t.lock.errors
  if (!p) return x.unknown(String(e instanceof Error ? e.message : e))
  switch (p.code) {
    case 'retryLater':
      return x.retryLater(t.lock.wait(retryDelay(e) ?? 1000))
    case 'passwordTooShort':
      return x.passwordTooShort(minChars)
    case 'locked':
    case 'wrongPassword':
    case 'notEncrypted':
    case 'alreadyEncrypted':
    case 'corrupt':
    case 'unsupportedVersion':
    case 'passwordTooLong':
    case 'notConfirmed':
    case 'persistFailed':
    case 'verifyFailed':
    case 'inconsistentFiles':
    case 'backupPasswordRequired':
    case 'invalidIdle':
    case 'random':
    case 'io':
      return x[p.code]
    default:
      return x.unknown(`lock:${p.code}`)
  }
}

/**
 * Contrôle de saisie d'un nouveau mot de passe (même règle de longueur que pulse-core, en caractères),
 * pour afficher l'erreur avant l'envoi. Renvoie null si la saisie peut partir.
 */
export function newPasswordError(t: Messages, password: string, confirm: string, minChars: number): string | null {
  if ([...password].length < minChars) return t.lock.errors.passwordTooShort(minChars)
  if (new TextEncoder().encode(password).length > 1024) return t.lock.errors.passwordTooLong
  if (password !== confirm) return t.lock.errors.mismatch
  return null
}
