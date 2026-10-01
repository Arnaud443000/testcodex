import { describe, expect, it } from 'vitest'
import { fr } from '../i18n/fr'
import { isLockedError, lockErrorText, newPasswordError, parseLockError, retryDelay } from './lockView'

describe('codes d’erreur du verrou', () => {
  it('lit les codes renvoyés par pulse-core', () => {
    expect(parseLockError('lock:wrongPassword')).toEqual({ code: 'wrongPassword', detail: undefined })
    expect(parseLockError(new Error('lock:retryLater:12000'))).toEqual({ code: 'retryLater', detail: '12000' })
    expect(parseLockError('lock:io:PermissionDenied')).toEqual({ code: 'io', detail: 'PermissionDenied' })
    expect(parseLockError('invalid input: something else')).toBeNull()
    expect(isLockedError('lock:locked')).toBe(true)
    expect(isLockedError('lock:wrongPassword')).toBe(false)
    expect(retryDelay('lock:retryLater:12000')).toBe(12000)
    expect(retryDelay('lock:wrongPassword')).toBeNull()
  })

  it('traduit chaque code, sans jamais répéter un secret', () => {
    expect(lockErrorText(fr, 'lock:wrongPassword')).toBe('Mot de passe incorrect.')
    expect(lockErrorText(fr, 'lock:retryLater:12000')).toBe('Trop d’essais : réessayez dans 12 s.')
    expect(lockErrorText(fr, 'lock:retryLater:80000')).toBe('Trop d’essais : réessayez dans 1 min 20 s.')
    expect(lockErrorText(fr, 'lock:retryLater:300000')).toBe('Trop d’essais : réessayez dans 5 min.')
    expect(lockErrorText(fr, 'lock:passwordTooShort', 8)).toContain('au moins 8 caractères')
    expect(lockErrorText(fr, 'lock:io:NotFound')).toContain('Rien n’a été changé')
    expect(lockErrorText(fr, 'lock:somethingNew')).toBe('Erreur : lock:somethingNew')
    for (const code of ['locked', 'notEncrypted', 'alreadyEncrypted', 'corrupt', 'unsupportedVersion', 'passwordTooLong', 'notConfirmed', 'persistFailed', 'verifyFailed', 'inconsistentFiles', 'backupPasswordRequired', 'invalidIdle', 'random']) {
      expect(lockErrorText(fr, `lock:${code}`)).not.toMatch(/^Erreur/)
    }
  })

  it('contrôle un nouveau mot de passe comme pulse-core (longueur en caractères)', () => {
    expect(newPasswordError(fr, 'court', 'court', 8)).toContain('au moins 8')
    expect(newPasswordError(fr, 'ééééééé', 'ééééééé', 8)).toContain('au moins 8')
    expect(newPasswordError(fr, 'éééééééé', 'éééééééé', 8)).toBeNull()
    expect(newPasswordError(fr, 'phrase de test jetable', 'phrase de test jetablE', 8)).toBe('Les deux mots de passe ne sont pas identiques.')
    expect(newPasswordError(fr, 'a'.repeat(1025), 'a'.repeat(1025), 8)).toContain('trop long')
  })
})
