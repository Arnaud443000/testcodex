// Lot 21 : affichage du coach IA, sans calcul. Le texte de l'IA est découpé par `parseAnalysis` (lot 20) et
// affiché comme du texte ; les chiffres « à vérifier » viennent de pulse-core, l'interface les liste.
import type { CoachStatus, CoachTurn, ConversationSummary } from '../types/coach'
import { aiErrorMessage } from './aiView'

export type CoachBlocker = 'disabled' | 'vault' | 'noKey' | null

/** Ce qui empêche de poser une question (les conversations passées restent lisibles). */
export function coachBlocker(s: CoachStatus): CoachBlocker {
  if (!s.enabled) return 'disabled'
  if (!s.vaultAvailable) return 'vault'
  if (!s.keyStored) return 'noKey'
  return null
}

/** Longueur comptée comme pulse-core (caractères, espaces de début et de fin retirés). */
export const questionLength = (q: string) => [...q.trim()].length

export function canSend(question: string, maxChars: number, opts: { busy: boolean; blocked: boolean; closed: boolean }): boolean {
  const n = questionLength(question)
  return n > 0 && n <= maxChars && !opts.busy && !opts.blocked && !opts.closed
}

/** Une conversation où l'on ne peut plus poser de question. */
export const isClosed = (c: ConversationSummary | null | undefined) => !!c && (c.readOnly || c.full)

export function toolLabel(name: string, labels: Record<string, string>): string {
  return labels[name] ?? name
}

/** JSON lisible, tel qu'envoyé (clés et valeurs inchangées). */
export function prettyJson(v: unknown): string {
  if (v == null || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0)) return '{}'
  return JSON.stringify(v, null, 2)
}

export function coachErrorMessage(
  error: unknown,
  texts: { aiErrors: Record<string, string>; coachErrors: Record<string, string>; unknownError: (d: string) => string },
): string {
  return aiErrorMessage(error, { errors: { ...texts.aiErrors, ...texts.coachErrors }, unknownError: texts.unknownError })
}

/** Message d'un tour échoué : son code `ai:…` traduit. */
export function turnErrorMessage(turn: CoachTurn, texts: Parameters<typeof coachErrorMessage>[1]): string | null {
  return turn.status === 'failed' ? coachErrorMessage(new Error(turn.errorCode ?? 'ai:unexpectedResponse'), texts) : null
}
