/**
 * Affichage de l'analyse avant trading (lot 31) : logique **pure** et testée. Aucun calcul métier : les règles
 * de la revue, du report, de l'ancienneté et du constat sont dans pulse-core ; ici on ne fait que lire un
 * brouillon de formulaire, formater des textes et choisir des libellés.
 */
import type {
  Analysis,
  AnswerInput,
  AnswerValue,
  EmotionsAnswer,
  Idea,
  IdeaNote,
  IdeaView,
  LinkedComparison,
  Question,
  Timeframe,
  TrendAnswer,
} from '../types/analysis'
import { MAX_SNOOZE_DAYS, MIN_SNOOZE_DAYS, TIMEFRAMES } from '../types/analysis'
import type { Comparison } from '../types/behavior'
import type { Tag } from '../types/trade'
import { formatNumber, formatPoints, formatR, formatRatioPercent } from './format'

const NB = '\u00a0'

/** Libellé d'une question : celui que l'utilisateur a saisi, sinon celui d'origine traduit depuis sa clé. */
export function questionLabel(q: Question, names: Record<string, string>): string {
  return q.label ?? names[q.key] ?? q.key
}

// --- Brouillon du formulaire ---------------------------------------------------------------------

/** Réponses en cours de saisie, par identifiant de question ; `undefined` = pas touchée. */
export type Draft = Record<number, AnswerValue | undefined>

/** Une réponse vide (aucune valeur utile) : jamais enregistrée, jamais remplacée par 0 ou une valeur par défaut. */
export function isBlank(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (typeof value === 'number') return false
  if (Array.isArray(value)) return value.length === 0
  if ('tagIds' in value) return !(value as EmotionsAnswer).text?.trim() && (value as EmotionsAnswer).tagIds.length === 0
  if ('note' in value && Object.keys(value).length === 1) return !(value as { note: string | null }).note?.trim()
  return Object.values(value as TrendAnswer).every((e) => !e || (!e.trend && !e.note?.trim()))
}

/** Le brouillon contient-il au moins une réponse utile parmi les questions actives ? */
export function hasAnswer(questions: Question[], draft: Draft): boolean {
  return questions.some((q) => !q.archived && !isBlank(draft[q.id]))
}

/**
 * Réponses à envoyer : une entrée par question active (vide = effacée côté cœur). Les questions archivées
 * ne sont jamais envoyées : leurs réponses passées restent donc intactes.
 */
export function draftAnswers(questions: Question[], draft: Draft): AnswerInput[] {
  return questions.filter((q) => !q.archived).map((q) => ({ questionId: q.id, value: isBlank(draft[q.id]) ? null : draft[q.id] }))
}

export function draftOf(a: Analysis): Draft {
  return Object.fromEntries(a.answers.map((x) => [x.questionId, x.value]))
}

// --- Heure et jour ---------------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0')

/** « 09:30 » : heure locale d'un instant, avec le décalage donné. */
export function formatTimeOfDay(ms: number, tz: number): string {
  const m = Math.floor((((ms + tz * 60_000) % 86_400_000) + 86_400_000) % 86_400_000 / 60_000)
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

/** Minutes depuis minuit d'une saisie « 9:30 », « 09h30 », « 0930 » ; `null` si ce n'est pas une heure. */
export function parseTimeInput(text: string): number | null {
  const m = /^(\d{1,2})\s*(?:[:hH]\s*(\d{2})?|(\d{2}))?$/.exec(text.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2] ?? m[3] ?? 0)
  return h <= 23 && min <= 59 ? h * 60 + min : null
}

/** Instant (ms UTC) de l'heure locale `minutes` du jour local `day` ("AAAA-MM-JJ"). */
export function instantOf(day: string, minutes: number, tz: number): number {
  const [y, mo, d] = day.split('-').map(Number)
  return Date.UTC(y, mo - 1, d) + minutes * 60_000 - tz * 60_000
}

/** Jour local "AAAA-MM-JJ" d'un instant. */
export function dayOfInstant(ms: number, tz: number): string {
  return new Date(ms + tz * 60_000).toISOString().slice(0, 10)
}

/** « mardi 29 septembre 2026 » (un jour calendaire : aucun fuseau en jeu). */
export function formatDayLong(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** « 29 septembre » (sans l'année), pour « Revient le … ». */
export function formatDayShort(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
}

// --- Lecture des réponses ---------------------------------------------------------------------------

export interface AnswerText {
  label: string
  /** Une ligne par élément (tendances : une par unité de temps). */
  lines: string[]
}

export interface Names {
  questions: Record<string, string>
  timeframes: Record<string, string>
  trends: Record<string, string>
  conviction: (n: number) => string
}

/** Tendances renseignées, dans l'ordre des unités de temps : « Journalière : Haussière — note ». */
export function trendLines(value: TrendAnswer, names: Names): string[] {
  const lines: string[] = []
  for (const tf of TIMEFRAMES) {
    const e = value[tf as Timeframe]
    if (!e || (!e.trend && !e.note)) continue
    const parts = [e.trend ? names.trends[e.trend] : null, e.note].filter(Boolean)
    lines.push(`${names.timeframes[tf]}${NB}: ${parts.join(' — ')}`)
  }
  return lines
}

/** Lecture d'une réponse : texte, nombre, setups et émotions par leur nom. */
export function answerLines(q: Question, value: AnswerValue, names: Names, tags: Tag[]): string[] {
  const tagName = (id: number) => tags.find((g) => g.id === id)?.name ?? `#${id}`
  switch (q.kind) {
    case 'shortText':
    case 'longText':
    case 'choice':
      return typeof value === 'string' && value ? [value] : []
    case 'conviction':
      return typeof value === 'number' ? [names.conviction(value)] : []
    case 'trend':
      return value && typeof value === 'object' && !Array.isArray(value) ? trendLines(value as TrendAnswer, names) : []
    case 'setups':
      return Array.isArray(value) ? [value.map(tagName).join(', ')] : []
    case 'emotions': {
      const v = value as EmotionsAnswer | null
      return v ? [v.text, v.tagIds.length ? v.tagIds.map(tagName).join(', ') : null].filter((x): x is string => !!x) : []
    }
    case 'news': {
      const note = (value as { note?: string | null } | null)?.note
      return note ? [note] : []
    }
  }
}

/** Toutes les réponses d'une analyse, dans l'ordre des questions ; une question archivée reste lisible. */
export function analysisTexts(a: Analysis, questions: Question[], names: Names, tags: Tag[]): (AnswerText & { archived: boolean })[] {
  const out: (AnswerText & { archived: boolean })[] = []
  for (const q of [...questions].sort((x, y) => x.position - y.position || x.id - y.id)) {
    const answer = a.answers.find((x) => x.questionId === q.id)
    if (!answer) continue
    const lines = answerLines(q, answer.value, names, tags)
    if (lines.length) out.push({ label: questionLabel(q, names.questions), lines, archived: q.archived })
  }
  return out
}

/** Résumé court (pour le formulaire de trade) : les `max` premières réponses, sur une ligne chacune. */
export function analysisSummary(a: Analysis, questions: Question[], names: Names, tags: Tag[], max = 3): AnswerText[] {
  return analysisTexts(a, questions, names, tags)
    .slice(0, max)
    .map(({ label, lines }) => ({ label, lines: [lines.join(' · ')] }))
}

// --- Idées ----------------------------------------------------------------------------------------

/** Choix rapides → nombre de jours ; `custom` lit la saisie libre. `null` si invalide (1 à 30 entiers). */
export function snoozeDays(choice: string, custom: string): number | null {
  const text = choice === 'custom' ? custom.trim() : choice
  if (!/^\d{1,3}$/.test(text)) return null
  const n = Number(text)
  return n >= MIN_SNOOZE_DAYS && n <= MAX_SNOOZE_DAYS ? n : null
}

export const SNOOZE_CHOICES = ['1', '2', '3', '7', 'custom'] as const

/** Niveau valide : chiffres et un point, sans espace ni exposant ; vide = aucun niveau. */
export function validLevel(text: string): boolean {
  const t = text.trim()
  return t === '' || (/^\d+(\.\d+)?$/.test(t) && /[1-9]/.test(t))
}

/** Prix bas et haut : le bas ne dépasse pas le haut (comparaison sur des chaînes décimales, sans flottant). */
export function levelsInOrder(low: string, high: string): boolean {
  const l = low.trim()
  const h = high.trim()
  if (!l || !h) return true
  const [li, lf = ''] = l.split('.')
  const [hi, hf = ''] = h.split('.')
  const width = Math.max(lf.length, hf.length)
  return BigInt(li + lf.padEnd(width, '0')) <= BigInt(hi + hf.padEnd(width, '0'))
}

export interface IdeaSections {
  /** Actives qui ne sont pas dans la revue d'aujourd'hui (les « à revoir » déjà revues y sont, marquées). */
  active: IdeaView[]
  snoozed: IdeaView[]
}

/** Répartit les idées actives : la revue du matin les montre à part, les reportées ont leur section. */
export function ideaSections(views: IdeaView[], inReview: Set<number>): IdeaSections {
  const rest = views.filter((v) => !inReview.has(v.id))
  return { active: rest.filter((v) => !v.snoozed), snoozed: rest.filter((v) => v.snoozed).sort((a, b) => (a.snoozedUntilDay ?? '').localeCompare(b.snoozedUntilDay ?? '') || a.id - b.id) }
}

/** « reportée N fois » seulement à partir de 2 : un texte neutre, jamais un reproche. */
export const showSnoozeCount = (n: number) => n >= 2

/** Dernière version du texte d'une idée : c'est le champ `note`. Le fil garde toutes les anciennes. */
export function threadOf(idea: Idea): IdeaNote[] {
  return [...idea.notes].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id)
}

export interface ThreadLabels {
  thread: Record<string, string>
  snooze: (day: string) => string
  closed: (outcome: string) => string
  outcomes: Record<string, string>
}

/** Une ligne du fil : libellé de l'entrée, puis son texte (les reports et clôtures se disent d'une phrase). */
export function threadLine(n: IdeaNote, l: ThreadLabels): { title: string; body: string } {
  if (n.kind === 'snooze') return { title: l.snooze(formatDayShort(n.data ?? '')), body: '' }
  if (n.kind === 'closed') return { title: l.closed(l.outcomes[n.data ?? ''] ?? ''), body: n.body }
  return { title: l.thread[n.kind] ?? n.kind, body: n.body }
}

// --- Constat -------------------------------------------------------------------------------------

export type ComparisonLine = { metric: 'discipline' | 'expectancy'; verdict: Comparison['verdict']; gap: string | null; values: [string, string] | null }

/** Écarts et valeurs prêts à afficher ; rien n'est recalculé (l'écart vient de pulse-core). */
export function comparisonLines(c: LinkedComparison): ComparisonLine[] {
  const line = (metric: 'discipline' | 'expectancy', cmp: Comparison, fmt: (v: number) => string, gap: (v: number) => string): ComparisonLine => ({
    metric,
    verdict: cmp.verdict,
    gap: cmp.difference === null ? null : gap(cmp.difference),
    values: cmp.present === null || cmp.absent === null ? null : [fmt(cmp.present), fmt(cmp.absent)],
  })
  return [
    line('discipline', c.discipline, (v) => formatNumber(v, 0), (d) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${formatNumber(Math.abs(d), 0)}${NB}points`),
    line('expectancy', c.expectancyR, (v) => formatR(v, 2), (d) => formatR(d, 2)),
  ]
}

/** Part de « a fonctionné » en pourcentage entier, ou « — ». */
export const formatRate = (rate: number | null) => (rate === null ? '—' : formatRatioPercent(rate, 0))

export { formatPoints }
