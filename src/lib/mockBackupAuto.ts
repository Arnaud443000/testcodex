/**
 * Fausse sauvegarde automatique du navigateur (lot 32) — **SIMULATION (navigateur)** : aucun fichier
 * n'est écrit, aucun dossier n'est lu. Les « sauvegardes » sont des instantanés en mémoire du faux
 * backend (restaurables par la restauration simulée existante) et disparaissent au rechargement.
 *
 * Mêmes règles visibles que `pulse-core/src/backup_auto.rs` (décision, nom, conservation des N plus
 * récentes, invitation, bannière, codes `backup:…`), vérifiées par `mockBackupAuto.test.ts` sur les
 * mêmes cas que les tests Rust. Pas de boucle d'arrière-plan : seul « Sauvegarder maintenant » écrit.
 */
import type { BackupInfo } from '../types/data'
import type {
  AutoBackupDone,
  AutoBackupEntry,
  AutoBackupSaved,
  AutoBackupSettings,
  AutoBackupStatus,
  BackupFrequency,
  FolderCheck,
} from '../types/backupAuto'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
export const CHECK_INTERVAL_MS = 30 * MINUTE
export const MIN_GAP_MS = 10 * MINUTE
export const RETRY_AFTER_FAILURE_MS = 30 * MINUTE
export const DAILY_MIN_MS = 12 * HOUR
export const WEEKLY_MS = 7 * DAY
export const INVITE_SNOOZE_MS = 14 * DAY
export const DEFAULT_KEEP = 10
export const MAX_KEEP = 60
export const NAME_PREFIX = 'pulse-auto-'
/** Dossier de données du faux backend (celui de `appInfo`). */
const MOCK_DATA_DIR = '(browser preview)'

const fail = (code: string) => new Error(`backup:${code}`)

export interface History {
  lastSuccessAt: number | null
  lastAttemptAt: number | null
}

/** La dernière tentative a échoué (instant noté avant le travail, réussite notée au même instant après). */
export function lastFailed(h: History): boolean {
  if (h.lastAttemptAt === null) return false
  return h.lastSuccessAt === null || h.lastAttemptAt > h.lastSuccessAt
}

const localDay = (ms: number, tz: number) => Math.floor((ms + tz * MINUTE) / DAY)
const periodMs = (f: BackupFrequency) => (f === 'daily' ? DAY : WEEKLY_MS)

/** Miroir de `backup_auto::is_due`. */
export function isDue(freq: BackupFrequency, h: History, now: number, tz: number): boolean {
  const a = h.lastAttemptAt
  if (a !== null) {
    if (Math.abs(now - a) < MIN_GAP_MS) return false
    if (lastFailed(h) && now > a && now - a < RETRY_AFTER_FAILURE_MS) return false
  }
  const s = h.lastSuccessAt
  if (s === null) return true
  const elapsed = now - s
  if (elapsed < 0) return true
  return freq === 'daily' ? elapsed >= DAILY_MIN_MS && localDay(now, tz) !== localDay(s, tz) : elapsed >= WEEKLY_MS
}

/** Miroir de `backup_auto::next_due_at`. */
export function nextDueAt(freq: BackupFrequency, h: History, now: number, tz: number): number {
  const s = h.lastSuccessAt
  let t =
    s !== null && s <= now
      ? freq === 'daily'
        ? Math.max(s + DAILY_MIN_MS, (localDay(s, tz) + 1) * DAY - tz * MINUTE)
        : s + WEEKLY_MS
      : now
  const a = h.lastAttemptAt
  if (a !== null && a <= now) {
    t = Math.max(t, a + MIN_GAP_MS)
    if (lastFailed(h)) t = Math.max(t, a + RETRY_AFTER_FAILURE_MS)
  }
  return Math.max(t, now)
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** Miroir de `backup_auto::backup_name` : `pulse-auto-AAAAMMJJ-HHMM`, heure locale. */
export function backupName(now: number, tz: number): string {
  const d = new Date(now + tz * MINUTE)
  return `${NAME_PREFIX}${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`
}

/** Miroir de `backup_auto::parse_name` : clé triable `AAAAMMJJHHMM`, `null` si le motif n'est pas exact. */
export function parseName(name: string): number | null {
  const m = /^pulse-auto-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(name)
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  if (mo < 1 || mo > 12 || d < 1 || d > days || h > 23 || mi > 59) return null
  return (((y * 100 + mo) * 100 + d) * 10_000) + h * 100 + mi
}

const labelOf = (key: number) => {
  const s = String(key).padStart(12, '0')
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`
}

export interface BackupAutoDeps {
  hasTrades: () => boolean
  encrypted: () => boolean
  /** Instantané restaurable du faux backend, rangé sous `path`. */
  snapshot: (path: string) => BackupInfo
  now?: () => number
}

/** États de démonstration pour les captures et les tests (aucun effet dans l'application réelle). */
export interface Simulation {
  lastSuccessAt?: number | null
  lastAttemptAt?: number | null
  lastError?: string | null
  /** Le prochain « Sauvegarder maintenant » échoue avec ce code. */
  failWith?: string | null
  sameDrive?: boolean
  /** Sauvegardes déjà présentes, faites à ces instants (heure locale `tz`). */
  seedBackups?: { at: number[]; tz: number }
}

export function createBackupAutoMock(deps: BackupAutoDeps) {
  const clock = deps.now ?? Date.now
  let settings: AutoBackupSettings = { enabled: false, folder: null, frequency: 'daily', keep: DEFAULT_KEEP }
  let history: History = { lastSuccessAt: null, lastAttemptAt: null }
  let lastError: string | null = null
  let invited: string | null = null
  let failWith: string | null = null
  let sameDrive = false
  const entries = new Map<string, AutoBackupEntry>()

  function checkFolder(folder: string): FolderCheck {
    if (folder.startsWith(MOCK_DATA_DIR)) throw fail('insideDataFolder')
    return { path: folder, sameDrive }
  }

  function status(tz: number): AutoBackupStatus {
    const now = clock()
    const active = settings.enabled && settings.folder !== null
    const stale =
      active &&
      (history.lastSuccessAt !== null ? now - history.lastSuccessAt > 2 * periodMs(settings.frequency) : lastFailed(history) && lastError !== null)
    const open = invited === null || (invited.startsWith('later:') && now >= Number(invited.slice(6)))
    return {
      settings: { ...settings },
      lastSuccessAt: history.lastSuccessAt,
      lastAttemptAt: history.lastAttemptAt,
      lastError,
      lastFailed: lastFailed(history),
      nextDueAt: active ? nextDueAt(settings.frequency, history, now, tz) : null,
      daysSinceSuccess: history.lastSuccessAt === null ? null : Math.floor(Math.max(0, now - history.lastSuccessAt) / DAY),
      stale,
      invite: !settings.enabled && deps.hasTrades() && open,
      encrypted: deps.encrypted(),
      checkIntervalMs: CHECK_INTERVAL_MS,
    }
  }

  function addEntry(name: string): BackupInfo {
    const path = `${settings.folder}/${name}`
    const info = deps.snapshot(path)
    entries.set(name, {
      name,
      path,
      at: labelOf(parseName(name) ?? 0),
      sizeBytes: 48_000 + info.trades * 1_200 + info.screenshots * 180_000,
      encrypted: info.encrypted,
      complete: true,
    })
    return info
  }

  function prune(newest: string): string[] {
    const others = [...entries.values()]
      .filter((e) => e.name !== newest)
      .sort((a, b) => (parseName(b.name) ?? 0) - (parseName(a.name) ?? 0))
    return others.slice(Math.max(0, settings.keep - 1)).map((e) => {
      entries.delete(e.name)
      return e.name
    })
  }

  return {
    getStatus: async (tz: number): Promise<AutoBackupStatus> => status(tz),
    setSettings: async (next: AutoBackupSettings, tz: number): Promise<AutoBackupSaved> => {
      if (!Number.isInteger(next.keep) || next.keep < 1 || next.keep > MAX_KEEP) throw fail('invalidKeep')
      const folder = next.folder?.trim() || null
      if (next.enabled && !folder) throw fail('noFolder')
      const folderCheck = folder && (next.enabled || folder !== settings.folder) ? checkFolder(folder) : null
      settings = { enabled: next.enabled, folder, frequency: next.frequency, keep: next.keep }
      if (next.enabled) invited = 'done'
      return { status: status(tz), folderCheck }
    },
    checkFolder: async (folder: string): Promise<FolderCheck> => checkFolder(folder),
    runNow: async (tz: number): Promise<AutoBackupDone> => {
      const folder = settings.folder
      if (!folder) throw fail('noFolder')
      const now = clock()
      history = { ...history, lastAttemptAt: now }
      const code = failWith
      failWith = null
      const name = backupName(now, tz)
      const error = code ?? (entries.has(name) ? 'alreadyExists' : null)
      if (error) {
        lastError = error
        throw fail(error)
      }
      const info = addEntry(name)
      const pruned = prune(name)
      history = { lastSuccessAt: now, lastAttemptAt: now }
      lastError = null
      return { info, name, pruned, pruneError: null }
    },
    list: async (): Promise<AutoBackupEntry[]> =>
      [...entries.values()].sort((a, b) => (parseName(b.name) ?? 0) - (parseName(a.name) ?? 0)),
    answerInvite: async (accept: boolean): Promise<void> => {
      invited = accept || invited !== null ? 'done' : `later:${clock() + INVITE_SNOOZE_MS}`
    },
    openFolder: async (): Promise<void> => {
      if (!settings.folder) throw fail('noFolder')
    },
    /** Captures et tests seulement : place le faux backend dans un état de démonstration. */
    simulate: (s: Simulation) => {
      if (s.lastSuccessAt !== undefined) history = { ...history, lastSuccessAt: s.lastSuccessAt }
      if (s.lastAttemptAt !== undefined) history = { ...history, lastAttemptAt: s.lastAttemptAt }
      if (s.lastError !== undefined) lastError = s.lastError
      if (s.failWith !== undefined) failWith = s.failWith
      if (s.sameDrive !== undefined) sameDrive = s.sameDrive
      for (const at of s.seedBackups?.at ?? []) {
        if (settings.folder) addEntry(backupName(at, s.seedBackups?.tz ?? 0))
      }
    },
  }
}
