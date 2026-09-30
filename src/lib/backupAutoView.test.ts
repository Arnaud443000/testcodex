import { describe, expect, it } from 'vitest'
import { fr } from '../i18n/fr'
import type { AutoBackupStatus } from '../types/backupAuto'
import { backupErrorCode, backupErrorText, bannerFor, formatSize, middleEllipsis, nextDueText, parseKeep } from './backupAutoView'

const NB = '\u00a0'
const status = (s: Partial<AutoBackupStatus> = {}): AutoBackupStatus => ({
  settings: { enabled: true, folder: 'E:\\OneDrive\\Pulse', frequency: 'daily', keep: 10 },
  lastSuccessAt: null,
  lastAttemptAt: null,
  lastError: null,
  lastFailed: false,
  nextDueAt: null,
  daysSinceSuccess: null,
  stale: false,
  invite: false,
  encrypted: false,
  checkIntervalMs: 1_800_000,
  ...s,
})

describe('affichage de la sauvegarde automatique', () => {
  it('codes d’erreur de pulse-core traduits, message inconnu gardé', () => {
    expect(backupErrorCode(new Error('backup:diskFull'))).toBe('diskFull')
    expect(backupErrorCode('backup:fileInUse')).toBe('fileInUse')
    expect(backupErrorCode('lock:locked')).toBeNull()
    expect(backupErrorText(fr, 'diskFull')).toBe(fr.backupAuto.errors.diskFull)
    expect(backupErrorText(fr, new Error('backup:insideDataFolder'))).toContain('dossier de données')
    expect(backupErrorText(fr, 'boom inattendu')).toBe(`L’opération a échoué${NB}: boom inattendu`)
  })
  it('chemin coupé au milieu', () => {
    expect(middleEllipsis('D:\\Sauvegardes')).toBe('D:\\Sauvegardes')
    const long = 'C:\\Users\\Arnaud\\OneDrive - Entreprise\\Documents\\Trading\\Pulse\\Sauvegardes automatiques'
    const short = middleEllipsis(long, 40)
    expect([...short].length).toBe(40)
    expect(short.startsWith('C:\\Users')).toBe(true)
    expect(short.endsWith('automatiques')).toBe(true)
    expect(short).toContain('…')
  })
  it('tailles lisibles', () => {
    expect(formatSize(fr, 512)).toBe(`512${NB}o`)
    expect(formatSize(fr, 48_000)).toBe(`47${NB}Ko`)
    expect(formatSize(fr, 1_468_006)).toBe(`1,4${NB}Mo`)
    expect(formatSize(fr, 2_254_857_830)).toBe(`2,1${NB}Go`)
  })
  it('prochaine sauvegarde', () => {
    expect(nextDueText(fr, status({ nextDueAt: null }), 1000)).toBe('—')
    expect(nextDueText(fr, status({ nextDueAt: 900 }), 1000)).toBe(fr.backupAuto.nextSoon)
    expect(nextDueText(fr, status({ nextDueAt: 1_790_726_400_000 }), 1000)).toMatch(/2026/)
  })
  it('bannière : sauvegarde ancienne d’abord, invitation sinon, rien sur Paramètres', () => {
    const opts = { onSettings: false, dismissedStale: false }
    expect(bannerFor(null, opts)).toBeNull()
    expect(bannerFor(status({ stale: true, lastSuccessAt: 1, daysSinceSuccess: 3 }), opts)).toEqual({ kind: 'stale', days: 3, cause: null })
    expect(bannerFor(status({ stale: true, lastSuccessAt: null, lastFailed: true, lastError: 'diskFull' }), opts)).toEqual({ kind: 'stale', days: null, cause: 'diskFull' })
    expect(bannerFor(status({ stale: true, lastSuccessAt: 1, daysSinceSuccess: 3 }), { ...opts, onSettings: true })).toBeNull()
    expect(bannerFor(status({ stale: true, daysSinceSuccess: 3 }), { ...opts, dismissedStale: true })).toBeNull()
    expect(bannerFor(status({ invite: true, settings: { enabled: false, folder: null, frequency: 'daily', keep: 10 } }), opts)).toEqual({ kind: 'invite' })
    expect(bannerFor(status(), opts)).toBeNull()
  })
  it('nombre gardé', () => {
    expect(parseKeep(' 10 ', 60)).toBe(10)
    for (const bad of ['0', '61', '2.5', '-1', '', 'dix', '1e1']) expect(parseKeep(bad, 60), bad).toBeNull()
  })
})
