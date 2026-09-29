import { describe, expect, it } from 'vitest'
import { createLockMock, delayAfter } from './mockLock'

// Mots de passe de test évidents et jetables.
const PW = 'phrase de test jetable'

describe('faux verrou (simulation)', () => {
  it('suit le même barème de délai que pulse-core', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(delayAfter)).toEqual([0, 0, 0, 5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000])
  })

  it('est désactivé par défaut et refuse une activation sans « J’ai compris » ou trop courte', async () => {
    const m = createLockMock(() => 0)
    expect(await m.status()).toMatchObject({ enabled: false, locked: false, plainCopies: ['pulse-pre-migration-v12.db'] })
    await expect(m.enable(PW, false, true)).rejects.toThrow('lock:notConfirmed')
    await expect(m.enable('court', true, true)).rejects.toThrow('lock:passwordTooShort')
    await expect(m.enable('ééééééé', true, true)).rejects.toThrow('lock:passwordTooShort')
    expect((await m.enable(PW, true, true)).enabled).toBe(true)
    await expect(m.enable(PW, true, true)).rejects.toThrow('lock:alreadyEncrypted')
    expect((await m.status()).plainCopies).toEqual([])
  })

  it('verrouille, refuse un mauvais mot de passe, impose un délai après 3 erreurs, puis rouvre', async () => {
    let now = 1_000
    const m = createLockMock(() => now)
    await m.enable(PW, true, false)
    expect((await m.lockNow()).locked).toBe(true)
    for (let i = 0; i < 3; i++) await expect(m.unlock('mauvais mot de passe')).rejects.toThrow('lock:wrongPassword')
    await expect(m.unlock(PW)).rejects.toThrow('lock:retryLater:5000')
    expect((await m.status()).retryAfterMs).toBe(5000)
    now += 5000
    const s = await m.unlock(PW)
    expect(s).toMatchObject({ locked: false, failures: 0, retryAfterMs: 0 })
  })

  it('change le mot de passe et le désactive avec le bon seulement', async () => {
    const m = createLockMock(() => 0)
    await m.enable(PW, true, false)
    await expect(m.changePassword('pas le bon du tout', 'nouveau mot de passe')).rejects.toThrow('lock:wrongPassword')
    await m.changePassword(PW, 'nouveau mot de passe')
    await expect(m.disable(PW)).rejects.toThrow('lock:wrongPassword')
    expect((await m.disable('nouveau mot de passe')).enabled).toBe(false)
    await expect(m.lockNow()).rejects.toThrow('lock:notEncrypted')
  })

  it('valide le délai d’inactivité et ne le montre que déverrouillé', async () => {
    const m = createLockMock(() => 0)
    await m.enable(PW, true, false)
    expect((await m.setIdle(15)).idleMinutes).toBe(15)
    await expect(m.setIdle(0)).rejects.toThrow('lock:invalidIdle')
    await expect(m.setIdle(1441)).rejects.toThrow('lock:invalidIdle')
    expect((await m.lockNow()).idleMinutes).toBeNull()
  })

  it('ne garde jamais le mot de passe en clair', async () => {
    const m = createLockMock(() => 0)
    await m.enable(PW, true, false)
    expect(JSON.stringify(m.currentSeal())).not.toContain(PW)
    expect(JSON.stringify(await m.status())).not.toContain(PW)
  })

  it('demande le mot de passe d’une sauvegarde simulée chiffrée', async () => {
    const m = createLockMock(() => 0)
    await m.enable(PW, true, false)
    const seal = m.currentSeal()!
    expect(() => m.checkBackupPassword(seal, undefined)).toThrow('lock:backupPasswordRequired')
    expect(() => m.checkBackupPassword(seal, 'mauvais mot de passe')).toThrow('lock:wrongPassword')
    expect(() => m.checkBackupPassword(seal, PW)).not.toThrow()
  })
})
