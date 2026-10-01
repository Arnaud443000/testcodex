/**
 * Affichage du calendrier économique (lot 25) : aucun calcul d'heure ici — jour et heure de Paris
 * arrivent de pulse-core. Seulement du regroupement, des libellés et la traduction des codes `news:…`.
 */
import type { Messages } from '../i18n'
import type { EconomicEvent, Importance } from '../types/news'
import { formatDuration } from './format'

export const IMPORTANCES: Importance[] = ['high', 'medium', 'low']

/** Seul hôte contacté par la source Forex Factory (`pulse_core::news::ff::HOST`). */
export const FOREX_FACTORY_HOST = 'nfs.faireconomy.media'

/** Mêmes devises que `pulse_core::news::CURRENCIES`. */
export const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'CNY', 'CNH', 'HKD', 'SGD', 'SEK', 'NOK', 'DKK', 'PLN',
  'CZK', 'HUF', 'TRY', 'ZAR', 'MXN', 'BRL', 'INR', 'KRW', 'RUB', 'ILS', 'THB', 'TWD', 'IDR', 'SAR', 'AED',
]

/** 3 barres pour « forte », 2 pour « moyenne », 1 pour « faible » : la forme double le texte. */
export function importanceBars(i: Importance): number {
  return i === 'high' ? 3 : i === 'medium' ? 2 : 1
}

/** Message traduit d'une erreur du calendrier (`news:<code>` n'importe où dans le texte), sinon le détail brut. */
export function newsErrorMessage(e: unknown, t: Messages['news']): string {
  const text = e instanceof Error ? e.message : String(e)
  const code = /news:([A-Za-z]+)/.exec(text)?.[1]
  const errors = t.errors as unknown as Record<string, string | undefined>
  if (code && typeof errors[code] === 'string') return errors[code] as string
  return t.errors.unknown(text)
}

/** Code `news:…` stocké (dernière tentative échouée) → message. */
export function storedErrorMessage(code: string | null, t: Messages['news']): string | null {
  return code === null ? null : newsErrorMessage(code, t)
}

/** Heure de l'horloge du PC « 21:34 » (prochaine requête permise : c'est l'heure que l'utilisateur voit). */
export function formatClock(ms: number): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(ms)
}

/** Les événements regroupés par jour, dans l'ordre reçu (pulse-core trie déjà). */
export function groupByDay(events: EconomicEvent[]): { day: string; events: EconomicEvent[] }[] {
  const out: { day: string; events: EconomicEvent[] }[] = []
  for (const e of events) {
    const last = out[out.length - 1]
    if (last && last.day === e.day) last.events.push(e)
    else out.push({ day: e.day, events: [e] })
  }
  return out
}

/** Temps restant avant une news : « dans 2 h 15 min », « en cours » dans la minute, « aujourd'hui » sans heure. */
export function countdown(e: EconomicEvent, nowMs: number, t: Messages['news']): string {
  if (e.startsAt === null) return t.widget.todayAllDay
  const left = e.startsAt - nowMs
  return left < 60_000 ? t.widget.now : t.widget.in(formatDuration(left))
}

/** Ajoute ou retire une valeur d'un filtre à choix multiples. */
export function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

/** Importances à demander pour un mode du widget. */
export function widgetImportances(mode: string | null): Importance[] {
  if (mode === 'high') return ['high']
  if (mode === 'all') return []
  return ['medium', 'high']
}

/** Les valeurs publiées d'un événement, dans l'ordre prévu / précédent / réel, `—` si absente. */
export function valueCells(e: EconomicEvent): [string, string, string] {
  return [e.forecast ?? '—', e.previous ?? '—', e.actual ?? '—']
}
