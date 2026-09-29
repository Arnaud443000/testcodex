/**
 * Faux calendrier économique du navigateur (lot 25) — **SIMULATION** : aucun appel réseau, aucun
 * fichier lu. « Importer » et « Actualiser » ajoutent des événements **simulés** (source
 * `simulation`, affichés avec le badge « Simulation »). Mêmes règles visibles que pulse-core :
 * désactivé par défaut, aucune source en ligne par défaut, adresse HTTPS vérifiée, consentement
 * exigé pour Forex Factory (lot 28), une fois par jour à l'ouverture, pas deux requêtes en
 * 5 minutes (test compris), heure de Paris (règle de l'UE). « Tester la source » renvoie des
 * événements simulés et n'enregistre rien avant confirmation.
 */
import type {
  CalendarView,
  EconomicEvent,
  FetchState,
  ImportSummary,
  Importance,
  NewsCalendar,
  NewsDefaults,
  NewsFileFormat,
  NewsFilter,
  NewsPreview,
  NewsRefresh,
  NewsSettings,
  NewsSourceKind,
  NewsStatus,
} from '../types/news'

const DAY = 86_400_000
const HOUR = 3_600_000
const MIN = 60_000
export const MAX_WINDOW_MIN = 240
export const MIN_FETCH_GAP_MS = 5 * MIN
const MAX_URL_LEN = 2048

export { CURRENCIES, FOREX_FACTORY_HOST } from './newsView'
import { CURRENCIES, FOREX_FACTORY_HOST } from './newsView'

const PREVIEW_EVENTS = 3
const PREVIEW_TTL_MS = 30 * MIN

export const DEFAULT_NEWS_SETTINGS: NewsSettings = {
  enabled: false,
  source: 'none',
  icsUrl: null,
  icsImportance: 'medium',
  icsCurrency: null,
  ffConsent: false,
  windowBeforeMin: 15,
  windowAfterMin: 15,
  alert: true,
}

const fail = (code: string) => new Error(`news:${code}`)

// --- Heure de Paris : même règle que `pulse_core::news::zones` (UE, depuis 1996) ---

const isoWeekday = (day: number) => ((((day + 3) % 7) + 7) % 7) + 1
function lastSunday(year: number, month: number): number {
  const last = Date.UTC(year, month, 0) / DAY
  return last - (isoWeekday(last) % 7)
}

export function parisOffsetMin(utc: number): number {
  const y = new Date(utc).getUTCFullYear()
  const start = lastSunday(y, 3) * DAY + HOUR
  const end = lastSunday(y, 10) * DAY + HOUR
  return utc >= start && utc < end ? 120 : 60
}

export const parisDayNumber = (utc: number) => Math.floor((utc + parisOffsetMin(utc) * MIN) / DAY)
export function dayKeyOf(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10)
}
export const parisDay = (utc: number) => dayKeyOf(parisDayNumber(utc))
export function parisHhmm(utc: number): string {
  const m = Math.floor(((((utc + parisOffsetMin(utc) * MIN) % DAY) + DAY) % DAY) / MIN)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
/** Premier instant où Paris affiche cette heure ; `null` si elle n'a pas existé (passage à l'heure d'été). */
export function parisToUtc(day: number, minuteOfDay: number): number | null {
  const local = day * DAY + minuteOfDay * MIN
  const found = [120, 60].map((off) => local - off * MIN).filter((utc) => parisOffsetMin(utc) === (local - utc) / MIN)
  return found.length ? Math.min(...found) : null
}
export function parisWeek(now: number): [string, string] {
  const today = parisDayNumber(now)
  const monday = today - (isoWeekday(today) - 1)
  return [dayKeyOf(monday), dayKeyOf(monday + 6)]
}

// --- Contrôles : miroir de `news::settings` ---

/** Hôte d'une adresse valable, sinon erreur `news:…` (mêmes règles que `check_url`). */
export function checkUrl(url: string): string {
  const u = url.trim()
  if (!u.startsWith('https://')) throw fail('urlNotHttps')
  if (u.length > MAX_URL_LEN || /[\s\u0000-\u001f]/.test(u)) throw fail('invalidUrl')
  const authority = u.slice(8).split(/[/?#]/)[0]
  if (authority.includes('@')) throw fail('urlWithCredentials')
  const colon = authority.lastIndexOf(':')
  const host = colon >= 0 && /^\d*$/.test(authority.slice(colon + 1)) ? authority.slice(0, colon) : authority
  if (!host || host.startsWith('.') || host.endsWith('.')) throw fail('invalidUrl')
  return host.toLowerCase()
}

function checkCurrency(c: string | null): string | null {
  const t = (c ?? '').trim()
  if (!t) return null
  const up = t.toUpperCase()
  if (!CURRENCIES.includes(up)) throw fail('invalidCurrency')
  return up
}

/** Réglages normalisés, ou erreur `news:…` (miroir de `news::settings::validate`). */
export function validateNewsSettings(s: NewsSettings): NewsSettings {
  const url = s.icsUrl?.trim() ? s.icsUrl.trim() : null
  if (url) checkUrl(url)
  if (s.source === 'icsUrl' && !url) throw fail('noSource')
  if (s.source === 'forexFactory' && !s.ffConsent) throw fail('consentRequired')
  if (s.windowBeforeMin < 0 || s.windowAfterMin < 0 || s.windowBeforeMin > MAX_WINDOW_MIN || s.windowAfterMin > MAX_WINDOW_MIN) throw fail('invalidWindow')
  return { ...s, icsUrl: url, icsCurrency: checkCurrency(s.icsCurrency) }
}

/** Ce qu'une source en ligne demanderait (`null` sans source prête). */
function planFor(s: NewsSettings): { source: NewsSourceKind; url: string } | null {
  if (s.source === 'icsUrl' && s.icsUrl) return { source: 'icsUrl', url: s.icsUrl }
  if (s.source === 'forexFactory' && s.ffConsent) return { source: 'forexFactory', url: `https://${FOREX_FACTORY_HOST}/ff_calendar_thisweek.json` }
  return null
}

function hostOf(s: NewsSettings): string | null {
  if (s.source === 'forexFactory') return FOREX_FACTORY_HOST
  if (s.source !== 'icsUrl' || !s.icsUrl) return null
  try {
    return checkUrl(s.icsUrl)
  } catch {
    return null
  }
}

// --- Événements simulés ---

interface Template {
  weekday: number
  time: string | null
  currency: string
  title: string
  importance: Importance
  forecast?: string
  previous?: string
}

const TEMPLATES: Template[] = [
  { weekday: 1, time: '10:30', currency: 'EUR', title: 'Confiance des investisseurs Sentix', importance: 'low', forecast: '-8,5', previous: '-9,2' },
  { weekday: 1, time: '16:00', currency: 'USD', title: 'ISM manufacturier', importance: 'high', forecast: '49,2', previous: '48,7' },
  { weekday: 1, time: null, currency: 'JPY', title: 'Jour férié au Japon (marchés fermés)', importance: 'low' },
  { weekday: 2, time: '11:00', currency: 'EUR', title: 'Inflation de la zone euro (estimation flash)', importance: 'high', forecast: '2,1 %', previous: '2,2 %' },
  { weekday: 2, time: '16:00', currency: 'USD', title: "Offres d'emploi JOLTS", importance: 'medium', forecast: '7,65 M', previous: '7,67 M' },
  { weekday: 3, time: '14:15', currency: 'USD', title: 'Emplois privés ADP', importance: 'medium', forecast: '125 k', previous: '99 k' },
  { weekday: 3, time: '16:30', currency: 'USD', title: 'Stocks de pétrole brut', importance: 'low', forecast: '-1,2 M', previous: '0,6 M' },
  { weekday: 3, time: '20:00', currency: 'USD', title: 'Décision de taux de la Fed (FOMC)', importance: 'high', forecast: '4,25 %', previous: '4,50 %' },
  { weekday: 4, time: '14:15', currency: 'EUR', title: 'Décision de taux de la BCE', importance: 'high', forecast: '2,00 %', previous: '2,00 %' },
  { weekday: 4, time: '14:30', currency: 'USD', title: 'Inscriptions hebdomadaires au chômage', importance: 'medium', forecast: '225 k', previous: '231 k' },
  { weekday: 5, time: '08:00', currency: 'GBP', title: 'PIB m/m', importance: 'medium', forecast: '0,1 %', previous: '0,4 %' },
  { weekday: 5, time: '14:30', currency: 'USD', title: "Rapport sur l'emploi américain (NFP)", importance: 'high', forecast: '140 k', previous: '22 k' },
  { weekday: 5, time: '14:30', currency: 'CAD', title: 'Taux de chômage', importance: 'medium', forecast: '7,1 %', previous: '7,1 %' },
]

/** Événements simulés des jours de Paris d'hier à dans 7 jours ; la valeur réelle est donnée pour ceux déjà passés. */
export function simulatedEvents(now: number): Omit<EconomicEvent, 'id' | 'updatedAt'>[] {
  const today = parisDayNumber(now)
  const out: Omit<EconomicEvent, 'id' | 'updatedAt'>[] = []
  for (let d = today - 1; d <= today + 7; d++) {
    for (const t of TEMPLATES.filter((x) => x.weekday === isoWeekday(d))) {
      const minute = t.time ? Number(t.time.slice(0, 2)) * 60 + Number(t.time.slice(3)) : null
      const startsAt = minute == null ? null : parisToUtc(d, minute)
      if (minute != null && startsAt == null) continue
      const past = startsAt != null && startsAt < now
      out.push({
        source: 'simulation',
        startsAt,
        day: dayKeyOf(d),
        parisTime: startsAt == null ? null : parisHhmm(startsAt),
        weekday: isoWeekday(d),
        currency: t.currency,
        title: t.title,
        importance: t.importance,
        forecast: t.forecast ?? null,
        previous: t.previous ?? null,
        actual: past && t.forecast ? t.forecast : null,
      })
    }
  }
  return out
}

const ORDER = (a: EconomicEvent, b: EconomicEvent) =>
  a.day.localeCompare(b.day) ||
  Number(a.startsAt != null) - Number(b.startsAt != null) ||
  (a.startsAt ?? 0) - (b.startsAt ?? 0) ||
  a.title.localeCompare(b.title) ||
  a.id - b.id

function matches(e: EconomicEvent, f: NewsFilter): boolean {
  return (!f.importances.length || f.importances.includes(e.importance)) && (!f.currencies.length || f.currencies.some((c) => c.trim().toUpperCase() === e.currency))
}

export function createNewsMock(now: () => number = Date.now) {
  let settings: NewsSettings = { ...DEFAULT_NEWS_SETTINGS }
  let state: FetchState = { lastAttemptAt: null, lastSuccessAt: null, lastError: null, lastCount: null, lastImportAt: null }
  let lastAttemptDay: string | null = null
  const events = new Map<string, EconomicEvent>()
  /** D'où vient chaque événement simulé (`file`, `icsUrl`, `forexFactory`) : quitter une source efface les siens. */
  const origin = new Map<string, string>()
  let held: { source: NewsSourceKind; url: string; at: number } | null = null
  let nextId = 1

  const status = (): NewsStatus => {
    const t = now()
    const next = state.lastAttemptAt != null ? state.lastAttemptAt + MIN_FETCH_GAP_MS : null
    return {
      settings: { ...settings },
      state: { ...state },
      eventCount: events.size,
      onlineReady: settings.enabled && planFor(settings) != null,
      onlineHost: hostOf(settings),
      nextRequestAt: next != null && next > t && next - t <= MIN_FETCH_GAP_MS ? next : null,
    }
  }

  const tooSoon = (t: number) => state.lastAttemptAt != null && t - state.lastAttemptAt < MIN_FETCH_GAP_MS && t >= state.lastAttemptAt

  /** Ajoute ou met à jour les événements simulés (la valeur réelle connue n'est jamais effacée). */
  const store = (at: number, from: string): ImportSummary => {
    let added = 0
    let updated = 0
    for (const sim of simulatedEvents(at)) {
      // Forex Factory ne donne aucune valeur réelle : la simulation non plus.
      const e = from === 'forexFactory' ? { ...sim, actual: null } : sim
      const key = `${e.day}|${e.startsAt ?? '-'}|${e.currency}|${e.title}`
      const old = events.get(key)
      if (old) {
        events.set(key, { ...old, ...e, actual: e.actual ?? old.actual, id: old.id, updatedAt: at })
        updated++
      } else {
        events.set(key, { ...e, id: nextId++, updatedAt: at })
        added++
      }
      origin.set(key, from)
    }
    return { added, updated, outsideWindow: 0, skipped: [], skippedCount: 0, purged: 0, removed: 0, partial: null }
  }

  const clearOrigin = (from: string) => {
    for (const [key, o] of origin) {
      if (o === from) {
        events.delete(key)
        origin.delete(key)
      }
    }
  }

  const succeed = (t: number, summary: ImportSummary) => {
    state = { ...state, lastSuccessAt: t, lastError: null, lastCount: summary.added + summary.updated }
  }

  return {
    async getNewsStatus(): Promise<NewsStatus> {
      return status()
    },

    async setNewsSettings(input: NewsSettings): Promise<NewsStatus> {
      const s = validateNewsSettings(input)
      const urlChanged = settings.icsUrl !== s.icsUrl
      const sourceChanged = settings.source !== s.source
      if (urlChanged || (sourceChanged && settings.source === 'icsUrl')) clearOrigin('icsUrl')
      if (sourceChanged && settings.source === 'forexFactory') clearOrigin('forexFactory')
      settings = s
      if (urlChanged || sourceChanged) {
        lastAttemptDay = null
        state = { ...state, lastSuccessAt: null, lastError: null, lastCount: null }
      }
      return status()
    },

    /** Aucun fichier n'est lu dans le navigateur : ajoute des événements simulés. */
    async importNewsFile(_format: NewsFileFormat, _path: string, defaults: NewsDefaults): Promise<ImportSummary> {
      if (!settings.enabled) throw fail('disabled')
      checkCurrency(defaults.currency)
      const summary = store(now(), 'file')
      state = { ...state, lastImportAt: now() }
      return summary
    },

    async refreshNews(manual: boolean): Promise<NewsRefresh> {
      const t = now()
      const refuse = (code: string) => {
        if (manual) throw fail(code)
        return { fetched: false, summary: null, status: status() }
      }
      if (!settings.enabled) return refuse('disabled')
      const plan = planFor(settings)
      if (!plan) return refuse('noSource')
      if (!manual && lastAttemptDay === parisDay(t)) return { fetched: false, summary: null, status: status() }
      if (tooSoon(t)) return refuse('tooSoon')
      state = { ...state, lastAttemptAt: t }
      lastAttemptDay = parisDay(t)
      const summary = store(t, plan.source)
      succeed(t, summary)
      return { fetched: true, summary, status: status() }
    },

    /** Simulation : aucune requête ; mêmes contrôles et même délai de 5 min que pulse-core, rien d'enregistré. */
    async testNewsSource(input: NewsSettings): Promise<NewsPreview> {
      const t = now()
      if (!settings.enabled) throw fail('disabled')
      const plan = planFor(validateNewsSettings(input))
      if (!plan) throw fail('noSource')
      if (tooSoon(t)) throw fail('tooSoon')
      state = { ...state, lastAttemptAt: t }
      const today = parisDay(t)
      const all = simulatedEvents(t).sort(
        (a, b) => a.day.localeCompare(b.day) || Number(a.startsAt != null) - Number(b.startsAt != null) || (a.startsAt ?? 0) - (b.startsAt ?? 0) || a.title.localeCompare(b.title),
      )
      const upcoming = all.filter((e) => (e.startsAt != null ? e.startsAt >= t : e.day >= today))
      held = { ...plan, at: t }
      return {
        count: all.length,
        events: (upcoming.length ? upcoming : all).slice(0, PREVIEW_EVENTS).map((e) => ({
          day: e.day,
          parisTime: e.parisTime,
          weekday: e.weekday,
          currency: e.currency,
          title: e.title,
          importance: e.importance,
          forecast: e.forecast,
          previous: e.previous,
        })),
        skipped: [],
        skippedCount: 0,
        partial: null,
      }
    },

    async keepTestedNews(): Promise<NewsRefresh> {
      const t = now()
      const h = held
      held = null
      if (!h || t - h.at > PREVIEW_TTL_MS) throw fail('previewOutdated')
      if (!settings.enabled) throw fail('disabled')
      const plan = planFor(settings)
      if (!plan || plan.source !== h.source || plan.url !== h.url) throw fail('previewOutdated')
      const summary = store(t, plan.source)
      succeed(t, summary)
      lastAttemptDay = parisDay(t)
      return { fetched: true, summary, status: status() }
    },

    async getNewsCalendar(view: CalendarView, filter: NewsFilter): Promise<NewsCalendar> {
      const t = now()
      const today = parisDay(t)
      const [fromDay, toDay] = view === 'today' ? [today, today] : parisWeek(t)
      const all = [...events.values()]
      const list = all.filter((e) => e.day >= fromDay && e.day <= toDay && matches(e, filter)).sort(ORDER)
      const currencies = [...new Set(all.map((e) => e.currency).filter(Boolean))].sort()
      return { today, fromDay, toDay, events: list, currencies }
    },

    async getUpcomingNews(limit: number, importances: Importance[]): Promise<EconomicEvent[]> {
      const t = now()
      const today = parisDay(t)
      return [...events.values()]
        .filter((e) => (e.startsAt != null ? e.startsAt >= t : e.day >= today) && matches(e, { importances, currencies: [] }))
        .sort(ORDER)
        .slice(0, Math.min(limit, 50))
    },

    async clearNewsEvents(): Promise<number> {
      const n = events.size
      events.clear()
      origin.clear()
      return n
    },
  }
}
