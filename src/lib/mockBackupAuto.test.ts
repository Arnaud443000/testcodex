import { describe, expect, it } from 'vitest'
import type { BackupInfo } from '../types/data'
import { backupName, createBackupAutoMock, isDue, lastFailed, nextDueAt, parseName, type History } from './mockBackupAuto'

// Mêmes cas que crates/pulse-core/src/backup_auto/tests.rs.
const M = 60_000
const H = 60 * M
const D = 24 * H
/** 2026-09-30 00:00 UTC. */
const DAY0 = 1_790_726_400_000
/** 2023-11-14 22:13:20 UTC = 23:13 à Paris. */
const NOW = 1_700_000_000_000
const TZ = 60
const ok = (s: number): History => ({ lastSuccessAt: s, lastAttemptAt: s })

describe('décision (miroir de backup_auto::is_due)', () => {
  it('jamais faite : tout de suite', () => {
    expect(isDue('daily', { lastSuccessAt: null, lastAttemptAt: null }, DAY0, 0)).toBe(true)
    expect(nextDueAt('daily', { lastSuccessAt: null, lastAttemptAt: null }, DAY0, 0)).toBe(DAY0)
  })
  it('quotidienne : autre jour local et 12 h', () => {
    expect(isDue('daily', ok(DAY0 + 8 * H), DAY0 + 23 * H + 59 * M, 0)).toBe(false)
    expect(isDue('daily', ok(DAY0 + 20 * H), DAY0 + D + H, 0)).toBe(false)
    expect(isDue('daily', ok(DAY0 + 20 * H), DAY0 + D + 8 * H, 0)).toBe(true)
    expect(isDue('daily', ok(DAY0 + 20 * H), DAY0 + D + 8 * H - 1, 0)).toBe(false)
    expect(nextDueAt('daily', ok(DAY0 + 20 * H), DAY0 + D, 0)).toBe(DAY0 + D + 8 * H)
    expect(nextDueAt('daily', ok(DAY0 + 8 * H), DAY0 + 9 * H, 0)).toBe(DAY0 + D)
  })
  it('le jour local suit le décalage', () => {
    expect(isDue('daily', ok(DAY0 + 10 * H), DAY0 + 23 * H, 0)).toBe(false)
    expect(isDue('daily', ok(DAY0 + 10 * H), DAY0 + 23 * H, 120)).toBe(true)
    expect(isDue('daily', ok(DAY0 + 10 * H), DAY0 + 23 * H, -420)).toBe(false)
  })
  it('hebdomadaire : 6 j 23 h non, 7 j oui', () => {
    expect(isDue('weekly', ok(DAY0), DAY0 + 6 * D + 23 * H, 0)).toBe(false)
    expect(isDue('weekly', ok(DAY0), DAY0 + 7 * D, 0)).toBe(true)
  })
  it('10 min entre deux essais, 30 min après un échec', () => {
    const back = (ago: number): History => ({ lastSuccessAt: DAY0 + D, lastAttemptAt: DAY0 - ago })
    expect(isDue('daily', back(9 * M), DAY0, 0)).toBe(false)
    expect(isDue('daily', back(11 * M), DAY0, 0)).toBe(true)
    const failed = (ago: number): History => ({ lastSuccessAt: DAY0 - 3 * D, lastAttemptAt: DAY0 - ago })
    expect(lastFailed(failed(M))).toBe(true)
    expect(isDue('daily', failed(11 * M), DAY0, 0)).toBe(false)
    expect(isDue('daily', failed(29 * M), DAY0, 0)).toBe(false)
    expect(isDue('daily', failed(30 * M), DAY0, 0)).toBe(true)
    expect(nextDueAt('daily', failed(11 * M), DAY0, 0)).toBe(DAY0 + 19 * M)
  })
})

describe('noms (miroir de backup_name / parse_name)', () => {
  it('heure locale, motif exact', () => {
    expect(backupName(NOW, TZ)).toBe('pulse-auto-20231114-2313')
    expect(backupName(NOW, 120)).toBe('pulse-auto-20231115-0013')
    expect(parseName('pulse-auto-20231114-2313')).toBe(202311142313)
    for (const bad of [
      'pulse-auto-20231114-2313-copie',
      'pulse-auto-20231114-231',
      'Pulse-auto-20231114-2313',
      'pulse-auto-20231314-2313',
      'pulse-auto-20230230-1200',
      'pulse-auto-20231114-2360',
      'pulse-auto-２０２３1114-2313',
      'pulse-backup-20231114-221320',
    ]) {
      expect(parseName(bad), bad).toBeNull()
    }
    expect(parseName('pulse-auto-20240229-0000')).toBe(202402290000)
  })
})

function setup(trades = 2) {
  let now = NOW
  const snaps: string[] = []
  const auto = createBackupAutoMock({
    hasTrades: () => trades > 0,
    encrypted: () => false,
    snapshot: (path): BackupInfo => {
      snaps.push(path)
      return { path, schemaVersion: 14, accounts: 1, trades, screenshots: 1, encrypted: false }
    },
    now: () => now,
  })
  return { auto, snaps, at: (t: number) => (now = t) }
}

describe('faux backend de la sauvegarde automatique', () => {
  it('réglages validés comme dans pulse-core', async () => {
    const { auto } = setup()
    await expect(auto.setSettings({ enabled: true, folder: null, frequency: 'daily', keep: 10 }, TZ)).rejects.toThrow('backup:noFolder')
    await expect(auto.setSettings({ enabled: true, folder: '(browser preview)/x', frequency: 'daily', keep: 10 }, TZ)).rejects.toThrow('backup:insideDataFolder')
    for (const keep of [0, 61, 2.5]) {
      await expect(auto.setSettings({ enabled: true, folder: 'D:\\Sauvegardes', frequency: 'daily', keep }, TZ)).rejects.toThrow('backup:invalidKeep')
    }
    expect((await auto.getStatus(TZ)).settings.enabled).toBe(false)
    const saved = await auto.setSettings({ enabled: true, folder: 'D:\\Sauvegardes', frequency: 'weekly', keep: 60 }, TZ)
    expect(saved.status.settings).toEqual({ enabled: true, folder: 'D:\\Sauvegardes', frequency: 'weekly', keep: 60 })
    expect(saved.folderCheck?.sameDrive).toBe(false)
    expect(saved.status.nextDueAt).toBe(NOW)
  })

  it('« Sauvegarder maintenant », conservation des N plus récentes, instantané restaurable', async () => {
    const { auto, snaps, at } = setup()
    await expect(auto.runNow(TZ)).rejects.toThrow('backup:noFolder')
    await auto.setSettings({ enabled: true, folder: 'D:\\S', frequency: 'daily', keep: 3 }, TZ)
    for (let i = 0; i < 3; i++) {
      at(NOW + i * D)
      await auto.runNow(TZ)
    }
    at(NOW + 3 * D)
    const done = await auto.runNow(TZ)
    expect(done.name).toBe('pulse-auto-20231117-2313')
    expect(done.pruned).toEqual(['pulse-auto-20231114-2313'])
    expect((await auto.list()).map((e) => e.name)).toEqual(['pulse-auto-20231117-2313', 'pulse-auto-20231116-2313', 'pulse-auto-20231115-2313'])
    expect(snaps[3]).toBe('D:\\S/pulse-auto-20231117-2313')
    // Même minute : refus plutôt que de mélanger deux sauvegardes.
    at(NOW + 3 * D + 20_000)
    await expect(auto.runNow(TZ)).rejects.toThrow('backup:alreadyExists')
    const st = await auto.getStatus(TZ)
    expect(st.lastError).toBe('alreadyExists')
    expect(st.lastFailed).toBe(true)
  })

  it('échec : code noté, bannière si jamais réussie, puis bannière « ancienne » au-delà de 2 × la fréquence', async () => {
    const { auto, at } = setup()
    await auto.setSettings({ enabled: true, folder: 'E:\\OneDrive\\Pulse', frequency: 'daily', keep: 10 }, TZ)
    auto.simulate({ failWith: 'diskFull' })
    await expect(auto.runNow(TZ)).rejects.toThrow('backup:diskFull')
    let st = await auto.getStatus(TZ)
    expect([st.lastError, st.lastFailed, st.stale]).toEqual(['diskFull', true, true])
    at(NOW + 31 * M)
    await auto.runNow(TZ)
    st = await auto.getStatus(TZ)
    expect([st.lastError, st.lastFailed, st.stale]).toEqual([null, false, false])
    at(NOW + 31 * M + 2 * D)
    expect((await auto.getStatus(TZ)).stale).toBe(false)
    at(NOW + 31 * M + 2 * D + 1)
    st = await auto.getStatus(TZ)
    expect([st.stale, st.daysSinceSuccess]).toEqual([true, 2])
  })

  it('invitation : seulement avec au moins un trade, « Plus tard » une fois 14 jours, jamais d’activation', async () => {
    expect((await setup(0).auto.getStatus(TZ)).invite).toBe(false)
    const { auto, at } = setup()
    expect((await auto.getStatus(TZ)).invite).toBe(true)
    await auto.answerInvite(false)
    at(NOW + 14 * D - 1)
    expect((await auto.getStatus(TZ)).invite).toBe(false)
    at(NOW + 14 * D)
    expect((await auto.getStatus(TZ)).invite).toBe(true)
    await auto.answerInvite(false)
    at(NOW + 400 * D)
    expect((await auto.getStatus(TZ)).invite).toBe(false)
    const other = setup().auto
    await other.answerInvite(true)
    const st = await other.getStatus(TZ)
    expect([st.invite, st.settings.enabled]).toEqual([false, false])
  })
})
