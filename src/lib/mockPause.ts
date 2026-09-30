import type { BehaviorInput } from './mockBehavior'
import { mockPauseReport, pauseContains, pauseEffectiveEnd } from './mockBehavior'
import { localDay } from './mockStats'
import type { StatsQuery } from '../types/stats'
import {
  MAX_PAUSE_MINUTES,
  MIN_PAUSE_MINUTES,
  PAUSE_NOTE_MAX_CHARS,
  PAUSE_REASONS,
  type CurrentPause,
  type NewPause,
  type Pause,
  type PauseReport,
  type PauseRow,
  type PauseSettings,
  type PauseStatus,
  type PauseSuggestion,
} from '../types/pause'

/**
 * MOCK de la pause volontaire (lot 35) — uniquement pour `npm run dev` dans un navigateur.
 * Miroir de `pulse-core/src/pause.rs` (CLAUDE.md, « Pause volontaire (lot 35) ») : mêmes bornes
 * [début ; fin), mêmes refus, même « jusqu'à demain matin ». Un rappel, jamais un blocage : rien ici
 * n'empêche de saisir un trade. Vérifié par `mockPause.test.ts` ; dans l'application, tout vient de Rust.
 */

const MIN = 60_000
const DAY = 86_400_000

export const DEFAULT_PAUSE_SETTINGS: PauseSettings = { suggestAfterLosses: null, defaultMinutes: 30 }

const invalid = (m: string) => new Error(`invalid input: ${m}`)

/** Premier instant du jour local suivant celui de `now`. */
export const nextLocalMidnight = (now: number, tzOffsetMin: number) => (Math.floor((now + tzOffsetMin * MIN) / DAY) + 1) * DAY - tzOffsetMin * MIN

export function checkPauseSettings(s: PauseSettings): void {
  if (s.suggestAfterLosses !== null && !(Number.isInteger(s.suggestAfterLosses) && s.suggestAfterLosses >= 2 && s.suggestAfterLosses <= 10))
    throw invalid('the number of losses that suggests a pause must be between 2 and 10')
  if (!(Number.isInteger(s.defaultMinutes) && s.defaultMinutes >= MIN_PAUSE_MINUTES && s.defaultMinutes <= MAX_PAUSE_MINUTES))
    throw invalid(`the default pause must last between ${MIN_PAUSE_MINUTES} and ${MAX_PAUSE_MINUTES} minutes`)
}

export interface PauseDeps {
  /** Données comportementales des comptes (liste vide = comptes actifs). */
  input: (accountIds: number[]) => BehaviorInput
  /** Instants d'entrée des trades des comptes (liste vide = comptes actifs), sans contrôle de devise. */
  entryTimes: (accountIds: number[]) => number[]
  /** Comptes actifs, pour la proposition (chaque compte seul). */
  activeAccountIds: () => number[]
}

export function createPauseMock(deps: PauseDeps) {
  const pauses: Pause[] = []
  let nextId = 1
  let settings: PauseSettings = { ...DEFAULT_PAUSE_SETTINGS }

  const running = (now: number) =>
    pauses.filter((p) => p.endedAt === null && p.startedAt <= now && p.plannedEndAt > now).sort((a, b) => b.startedAt - a.startedAt || b.id - a.id)[0]
  const clockWentBack = (now: number) => pauses.some((p) => p.endedAt === null && p.startedAt > now && p.plannedEndAt > now)

  function describe(p: Pause, now: number, entries: number[]): PauseRow {
    const status: PauseStatus = p.endedAt !== null && p.endedAt < p.plannedEndAt ? 'endedEarly' : now < p.plannedEndAt ? 'running' : 'completed'
    const actualEnd = status === 'running' ? Math.max(now, p.startedAt) : pauseEffectiveEnd(p)
    return {
      pause: { ...p },
      status,
      plannedMs: p.plannedEndAt - p.startedAt,
      actualMs: actualEnd - p.startedAt,
      tradeCount: entries.filter((t) => pauseContains(p, t)).length,
    }
  }

  return {
    /** Pour les tests et le faux backend : toutes les pauses, de la plus ancienne à la plus récente. */
    all: (): Pause[] => pauses.map((p) => ({ ...p })),
    reset: () => {
      pauses.length = 0
      nextId = 1
      settings = { ...DEFAULT_PAUSE_SETTINGS }
    },

    startPause: async (n: NewPause, now = Date.now()): Promise<Pause> => {
      const reason = n.reason?.trim() || null
      if (reason !== null && !(PAUSE_REASONS as readonly string[]).includes(reason)) throw invalid(`unknown pause reason: ${n.reason}`)
      const note = n.note?.trim() || null
      // eslint-disable-next-line no-control-regex
      if (note !== null && ([...note].length > PAUSE_NOTE_MAX_CHARS || /[\u0000-\u001f\u007f]/.test(note)))
        throw invalid(`the note of a pause is at most ${PAUSE_NOTE_MAX_CHARS} characters, on one line`)
      if (!(n.tzOffsetMin >= -840 && n.tzOffsetMin <= 840)) throw invalid('the time zone offset is out of range')
      let end: number
      if (n.length.kind === 'minutes') {
        const m = n.length.minutes
        if (!(Number.isInteger(m) && m >= MIN_PAUSE_MINUTES && m <= MAX_PAUSE_MINUTES))
          throw invalid(`a pause lasts between ${MIN_PAUSE_MINUTES} and ${MAX_PAUSE_MINUTES} minutes`)
        end = now + m * MIN
      } else {
        end = nextLocalMidnight(now, n.tzOffsetMin)
      }
      if (clockWentBack(now)) throw invalid('a pause starts after the current instant (the clock went back?)')
      // Une seule pause à la fois : la précédente est clôturée à cet instant.
      for (const p of pauses) if (p.endedAt === null && p.startedAt <= now && p.plannedEndAt > now) p.endedAt = now
      const pause: Pause = { id: nextId++, startedAt: now, plannedEndAt: end, endedAt: null, tzOffsetMin: n.tzOffsetMin, reason: reason as Pause['reason'], note }
      pauses.push(pause)
      return { ...pause }
    },

    endPause: async (now = Date.now()): Promise<Pause | null> => {
      if (clockWentBack(now)) throw invalid('a pause starts after the current instant (the clock went back?)')
      const p = running(now)
      if (!p) return null
      p.endedAt = now
      return { ...p }
    },

    getCurrentPause: async (now = Date.now()): Promise<CurrentPause | null> => {
      const p = running(now)
      if (!p) return null
      const remainingMs = p.plannedEndAt - now
      return { pause: { ...p }, remainingMs, remainingMin: Math.ceil(remainingMs / MIN) }
    },

    listPauses: async (accountIds: number[], limit = 20, now = Date.now()): Promise<PauseRow[]> => {
      const entries = deps.entryTimes(accountIds)
      return [...pauses]
        .sort((a, b) => b.startedAt - a.startedAt || b.id - a.id)
        .slice(0, Math.min(Math.max(limit, 1), 500))
        .map((p) => describe(p, now, entries))
    },

    getPauseReport: async (q: StatsQuery): Promise<PauseReport> => mockPauseReport(deps.input(q.accountIds ?? []), q, pauses),

    /** Pertes d'affilée clôturées aujourd'hui, par compte (comme l'alerte 3.6.1) ; une proposition, jamais une pause. */
    getPauseSuggestion: async (accountIds: number[], tzOffsetMin: number, now = Date.now()): Promise<PauseSuggestion | null> => {
      const threshold = settings.suggestAfterLosses
      if (threshold === null || running(now)) return null
      const today = localDay(now, tzOffsetMin)
      let best: PauseSuggestion | null = null
      for (const accountId of accountIds.length ? accountIds : deps.activeAccountIds()) {
        const closed = deps
          .input([accountId])
          .trades.flatMap((t) => (t.figures && t.exitTime != null && t.exitTime <= now && t.entryTime <= now ? [{ id: t.id, exitTime: t.exitTime, tz: t.tzOffsetMin, outcome: t.figures.outcome }] : []))
          .sort((a, b) => a.exitTime - b.exitTime || a.id - b.id)
          .filter((c) => localDay(c.exitTime, c.tz) === today)
        let losses = 0
        for (let i = closed.length - 1; i >= 0 && closed[i].outcome === 'loss'; i--) losses++
        if (losses >= threshold && (best === null || losses > best.losses)) best = { accountId, losses, threshold }
      }
      return best
    },

    getPauseSettings: async (): Promise<PauseSettings> => ({ ...settings }),
    setPauseSettings: async (s: PauseSettings): Promise<PauseSettings> => {
      checkPauseSettings(s)
      settings = { ...s }
      return { ...settings }
    },
  }
}
