/** Conversions entre le champ `datetime-local` (heure locale) et les millisecondes UTC de pulse-core. */

const pad = (n: number) => String(n).padStart(2, '0')

/** ms UTC → « 2026-09-28T09:42 » en heure locale (valeur d'un <input type="datetime-local">). */
export function toLocalInput(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** « 2026-09-28T09:42 » (heure locale) → ms UTC ; null si la saisie est incomplète ou invalide. */
export function fromLocalInput(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

/** Décalage UTC de l'ordinateur à cet instant, en minutes (120 pour UTC+2), comme le stocke pulse-core. */
export function tzOffsetMinutes(ms: number): number {
  return -new Date(ms).getTimezoneOffset()
}
