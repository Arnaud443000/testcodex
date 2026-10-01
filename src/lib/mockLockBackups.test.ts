import { describe, expect, it } from 'vitest'
import { mock, mockLock } from './mockBackend'

// Simulation du navigateur : une sauvegarde faite verrou actif demande son mot de passe (celui du moment).
describe('sauvegardes simulées et verrou', () => {
  it('une sauvegarde faite verrou actif est « chiffrée » et demande son mot de passe', async () => {
    const plain = await mock.createBackup('(dossier)')
    expect(plain.encrypted).toBe(false)
    expect((await mock.inspectBackup(plain.path)).encrypted).toBe(false)

    await mockLock.enable('phrase de test jetable', true, false)
    const sealed = await mock.createBackup('(dossier)')
    expect(sealed.encrypted).toBe(true)
    await expect(mock.inspectBackup(sealed.path)).rejects.toThrow('lock:backupPasswordRequired')
    await expect(mock.inspectBackup(sealed.path, 'mauvais mot de passe')).rejects.toThrow('lock:wrongPassword')
    expect((await mock.inspectBackup(sealed.path, 'phrase de test jetable')).encrypted).toBe(true)

    // Après un changement de mot de passe, l'ancienne sauvegarde garde l'ancien.
    await mockLock.changePassword('phrase de test jetable', 'nouveau mot de passe')
    await expect(mock.restoreBackup(sealed.path, true, 'nouveau mot de passe')).rejects.toThrow('lock:wrongPassword')
    const res = await mock.restoreBackup(sealed.path, true, 'phrase de test jetable')
    expect(res.safetyCopy.endsWith('.db.enc')).toBe(true)
  })
})
