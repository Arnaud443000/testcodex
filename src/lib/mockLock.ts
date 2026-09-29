/**
 * Faux verrou du navigateur (lot 22) — **SIMULATION** : aucun chiffrement, rien n'est écrit nulle part.
 *
 * Le mot de passe n'est jamais gardé, ni en mémoire ni dans `localStorage` : seule une empreinte
 * non cryptographique (FNV-1a d'un sel aléatoire + du mot de passe) est tenue en mémoire pour
 * pouvoir simuler « mot de passe incorrect » ; elle disparaît au rechargement de la page, comme
 * toutes les données du faux backend. Mêmes règles visibles que pulse-core : 8 caractères au moins,
 * case « J'ai compris », délai croissant après 3 erreurs (même barème), codes d'erreur `lock:…`.
 */
import type { LockStatus } from '../types/lock'

export const MIN_PASSWORD_CHARS = 8
const FREE_ATTEMPTS = 3
const FIRST_DELAY_MS = 5_000
const MAX_DELAY_MS = 300_000

/** Même barème que `pulse_lock::attempts::delay_after`. */
export function delayAfter(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0
  return Math.min(FIRST_DELAY_MS * 2 ** Math.min(failures - FREE_ATTEMPTS, 16), MAX_DELAY_MS)
}

const fail = (code: string) => new Error(`lock:${code}`)

/** Empreinte de simulation (pas une protection : FNV-1a 32 bits). */
function fingerprint(salt: string, password: string): string {
  let h = 0x811c9dc5
  for (const c of salt + '\u0000' + password) {
    h ^= c.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16)
}

export interface MockSeal {
  salt: string
  print: string
}

export function createLockMock(now: () => number = Date.now) {
  let seal: MockSeal | null = null
  let locked = false
  let failures = 0
  let lastFailure = 0
  let idleMinutes: number | null = null
  let plainCopies = ['pulse-pre-migration-v12.db']

  const retryAfter = () => {
    const d = delayAfter(failures)
    if (d === 0) return 0
    const end = lastFailure + d
    return now() >= end ? 0 : Math.min(end - now(), d)
  }

  /** Vérifie un mot de passe contre une empreinte, avec le compteur d'essais (comme `guarded`). */
  function guarded(target: MockSeal, password: string) {
    const wait = retryAfter()
    if (wait > 0) throw fail(`retryLater:${wait}`)
    if (fingerprint(target.salt, password) !== target.print) {
      failures += 1
      lastFailure = now()
      throw fail('wrongPassword')
    }
    failures = 0
  }

  function checkNew(password: string) {
    if ([...password].length < MIN_PASSWORD_CHARS) throw fail('passwordTooShort')
    if (new TextEncoder().encode(password).length > 1024) throw fail('passwordTooLong')
  }

  function newSeal(password: string): MockSeal {
    const salt = Math.random().toString(36).slice(2)
    return { salt, print: fingerprint(salt, password) }
  }

  const status = (): LockStatus => ({
    enabled: seal !== null,
    locked,
    retryAfterMs: retryAfter(),
    failures,
    idleMinutes: seal && !locked ? idleMinutes : null,
    persistFailed: false,
    warning: null,
    plainCopies,
    minPasswordChars: MIN_PASSWORD_CHARS,
  })

  return {
    status: async (): Promise<LockStatus> => status(),
    unlock: async (password: string): Promise<LockStatus> => {
      if (seal && locked) {
        guarded(seal, password)
        locked = false
      }
      return status()
    },
    enable: async (password: string, confirmed: boolean, encryptCopies: boolean): Promise<LockStatus> => {
      if (seal) throw fail('alreadyEncrypted')
      if (!confirmed) throw fail('notConfirmed')
      checkNew(password)
      seal = newSeal(password)
      if (encryptCopies) plainCopies = []
      return status()
    },
    disable: async (password: string): Promise<LockStatus> => {
      if (!seal) throw fail('notEncrypted')
      guarded(seal, password)
      seal = null
      idleMinutes = null
      return status()
    },
    changePassword: async (oldPassword: string, newPassword: string): Promise<LockStatus> => {
      if (!seal) throw fail('notEncrypted')
      guarded(seal, oldPassword)
      checkNew(newPassword)
      seal = newSeal(newPassword)
      return status()
    },
    lockNow: async (): Promise<LockStatus> => {
      if (!seal) throw fail('notEncrypted')
      locked = true
      return status()
    },
    setIdle: async (minutes: number | null): Promise<LockStatus> => {
      if (minutes !== null && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440)) throw fail('invalidIdle')
      idleMinutes = minutes
      return status()
    },
    touch: async (): Promise<void> => {},
    retryPersist: async (): Promise<LockStatus> => status(),
    /** Empreinte en vigueur, pour « chiffrer » une sauvegarde simulée (null = verrou inactif). */
    currentSeal: (): MockSeal | null => seal,
    /** Vérifie le mot de passe d'une sauvegarde simulée, sous le même compteur d'essais. */
    checkBackupPassword: (backupSeal: MockSeal, password: string | undefined) => {
      if (!password) throw fail('backupPasswordRequired')
      guarded(backupSeal, password)
    },
  }
}

export type LockMock = ReturnType<typeof createLockMock>
