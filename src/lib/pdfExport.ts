/**
 * Export PDF d'un bilan de période (lot 23) : choix de la période et lecture des codes d'erreur
 * `pdf:…` de pulse-core. Aucun calcul de performance ici : le document est fabriqué par pulse-core.
 */
import type { Messages } from '../i18n'

export type PdfPeriodKind = 'thisYear' | 'lastYear' | 'thisMonth' | 'lastMonth' | 'all' | 'custom'
export const PDF_PERIOD_KINDS: PdfPeriodKind[] = ['lastYear', 'thisYear', 'lastMonth', 'thisMonth', 'all', 'custom']

const DAY_MS = 86_400_000

/** Jour civil (nombre de jours depuis 1970-01-01) de « aaaa-mm-jj » ; null si la date n'existe pas. */
export function dayNumberOf(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = Date.UTC(y, mo - 1, d)
  const back = new Date(t)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null
  return t / DAY_MS
}

/** Minuit local (en ms UTC) du jour civil `day`. */
const midnight = (day: number, tzOffsetMin: number) => day * DAY_MS - tzOffsetMin * 60_000

export interface PdfPeriodInput {
  kind: PdfPeriodKind
  /** « aaaa-mm-jj » : seulement pour `custom` (bornes incluses). */
  fromDay?: string
  toDay?: string
}

export type PdfPeriodResult =
  | { ok: true; from: number | null; to: number | null }
  | { ok: false; error: 'missingDate' | 'badDate' | 'reversed' }

/**
 * Bornes `[from, to)` en ms UTC (minuit local, `to` exclu) d'une période de bilan. Pur calendrier.
 * `custom` : les deux jours sont inclus (`to` = minuit local du lendemain du dernier jour).
 */
export function pdfPeriodRange(input: PdfPeriodInput, nowMs: number, tzOffsetMin: number): PdfPeriodResult {
  const local = new Date(nowMs + tzOffsetMin * 60_000)
  const [y, m] = [local.getUTCFullYear(), local.getUTCMonth()]
  const dayOf = (year: number, month: number) => Date.UTC(year, month, 1) / DAY_MS
  const range = (fromDay: number, toDay: number) => ({ ok: true as const, from: midnight(fromDay, tzOffsetMin), to: midnight(toDay, tzOffsetMin) })
  switch (input.kind) {
    case 'all':
      return { ok: true, from: null, to: null }
    case 'thisYear':
      return range(dayOf(y, 0), dayOf(y + 1, 0))
    case 'lastYear':
      return range(dayOf(y - 1, 0), dayOf(y, 0))
    case 'thisMonth':
      return range(dayOf(y, m), dayOf(y, m + 1))
    case 'lastMonth':
      return range(dayOf(y, m - 1), dayOf(y, m))
    case 'custom': {
      if (!input.fromDay || !input.toDay) return { ok: false, error: 'missingDate' }
      const [a, b] = [dayNumberOf(input.fromDay), dayNumberOf(input.toDay)]
      if (a === null || b === null) return { ok: false, error: 'badDate' }
      if (a > b) return { ok: false, error: 'reversed' }
      return range(a, b + 1)
    }
  }
}

export interface PdfErrorCode {
  code: string
}

/** `pdf:mixedCurrencies` (dans « invalid input: pdf:… ») → { code: 'mixedCurrencies' } ; autre erreur → null. */
export function parsePdfError(e: unknown): PdfErrorCode | null {
  const text = String(e instanceof Error ? e.message : e)
  const m = /(?:^|\s)pdf:([A-Za-z]+)/.exec(text)
  return m ? { code: m[1] } : null
}

export const isFileExistsError = (e: unknown): boolean => parsePdfError(e)?.code === 'fileExists'

/** Message traduit d'une erreur de l'export PDF (message brut pour une erreur inconnue). */
export function pdfErrorText(t: Messages, e: unknown): string {
  const x = t.pdf.errors
  const p = parsePdfError(e)
  switch (p?.code) {
    case 'noAccount':
      return x.noAccount
    case 'multipleAccounts':
      return x.multipleAccounts
    case 'mixedCurrencies':
      return x.mixedCurrencies
    case 'invalidPeriod':
      return x.invalidPeriod
    case 'fileExists':
      return x.fileExists
    default:
      return x.unknown(String(e instanceof Error ? e.message : e))
  }
}

/** Nom de fichier proposé : jamais le nom du compte (le fichier peut être partagé). */
export const pdfFileName = (day: string): string => `pulse-bilan-${day}.pdf`
