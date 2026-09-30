import type { ProcessPeriodKind } from '../types/processGoals'

/**
 * Calendrier des objectifs de comportement (lot 34) : semaines ISO locales et mois locaux, comme
 * `Period` de pulse-core::process_goals. Pur calendrier, aucune statistique. Les jours sont comptés
 * depuis le 1er janvier 1970 (« numéro de jour »).
 */

const DAY = 86_400_000
/** Une série ne compte jamais plus d'un an de semaines (MAX_STREAK de pulse-core). */
export const MAX_STREAK = 52

export interface CalendarPeriod {
  kind: ProcessPeriodKind
  key: string
  /** Numéro du premier jour local. */
  firstDay: number
  days: number
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const civil = (day: number): [number, number, number] => {
  const d = new Date(day * DAY)
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]
}
const dayOf = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / DAY)
/** 1 = lundi … 7 = dimanche. */
const weekday = (day: number) => ((((day + 3) % 7) + 7) % 7) + 1
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

export const dayString = (day: number): string => {
  const [y, m, d] = civil(day)
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`
}

/** 53 semaines ISO si le 1er janvier est un jeudi, ou un mercredi d'année bissextile. */
function weeksInIsoYear(y: number): number {
  const jan1 = weekday(dayOf(y, 1, 1))
  return jan1 === 4 || (daysInMonth(y, 2) === 29 && jan1 === 3) ? 53 : 52
}

/** Lundi de la semaine 1 : celle qui contient le 4 janvier. */
function isoYearStart(y: number): number {
  const jan4 = dayOf(y, 1, 4)
  return jan4 - (weekday(jan4) - 1)
}

export function parsePeriod(kind: ProcessPeriodKind, key: string): CalendarPeriod | null {
  if (kind === 'week') {
    const m = /^(\d{4})-W(\d{2})$/.exec(key)
    if (!m) return null
    const [y, w] = [Number(m[1]), Number(m[2])]
    if (w < 1 || w > weeksInIsoYear(y)) return null
    return { kind, key, firstDay: isoYearStart(y) + (w - 1) * 7, days: 7 }
  }
  const m = /^(\d{4})-(\d{2})$/.exec(key)
  if (!m) return null
  const [y, mo] = [Number(m[1]), Number(m[2])]
  if (mo < 1 || mo > 12) return null
  return { kind, key, firstDay: dayOf(y, mo, 1), days: daysInMonth(y, mo) }
}

export function periodContaining(kind: ProcessPeriodKind, day: number): CalendarPeriod {
  const [y, m] = civil(day)
  if (kind === 'month') return parsePeriod('month', `${pad(y, 4)}-${pad(m)}`)!
  const monday = day - (weekday(day) - 1)
  const isoYear = civil(monday + 3)[0]
  const week = (monday - isoYearStart(isoYear)) / 7 + 1
  return { kind, key: `${pad(isoYear, 4)}-W${pad(week)}`, firstDay: monday, days: 7 }
}

export const previousPeriod = (p: CalendarPeriod) => periodContaining(p.kind, p.firstDay - 1)
export const nextPeriod = (p: CalendarPeriod) => periodContaining(p.kind, p.firstDay + p.days)
export const lastDay = (p: CalendarPeriod) => p.firstDay + p.days - 1

/** Numéro du jour local à l'instant `nowMs`. */
export const todayNumber = (nowMs: number, tzOffsetMin: number) => Math.floor((nowMs + tzOffsetMin * 60_000) / DAY)

export const currentPeriodKey = (kind: ProcessPeriodKind, nowMs: number, tzOffsetMin: number) =>
  periodContaining(kind, todayNumber(nowMs, tzOffsetMin)).key

/** Clé de la période décalée de `delta` périodes (négatif : vers le passé). */
export function shiftPeriod(kind: ProcessPeriodKind, key: string, delta: number): string {
  let p = parsePeriod(kind, key)
  if (!p) return key
  for (let i = 0; i < Math.abs(delta); i++) p = delta < 0 ? previousPeriod(p) : nextPeriod(p)
  return p.key
}

/**
 * Décalage UTC en vigueur à minuit local du premier jour de la période, des `MAX_STREAK + 1` périodes
 * précédentes et de la suivante, lu dans le fuseau du système (`Date`) ; seuls ceux qui diffèrent
 * de `tzOffsetMin` sont envoyés. pulse-core n'a pas de base de fuseaux : c'est ce qui lui permet de
 * placer une borne de l'autre côté d'un changement d'heure.
 */
export function boundaryOffsets(
  kind: ProcessPeriodKind,
  key: string,
  tzOffsetMin: number,
  offsetAt: (y: number, m: number, d: number) => number = (y, m, d) => -new Date(y, m - 1, d).getTimezoneOffset(),
): Record<string, number> {
  const out: Record<string, number> = {}
  let p = parsePeriod(kind, key)
  if (!p) return out
  const starts = [nextPeriod(p).firstDay]
  for (let i = 0; i <= MAX_STREAK + 1; i++) {
    starts.push(p.firstDay)
    p = previousPeriod(p)
  }
  for (const day of starts) {
    const [y, m, d] = civil(day)
    const offset = offsetAt(y, m, d)
    if (offset !== tzOffsetMin) out[dayString(day)] = offset
  }
  return out
}
