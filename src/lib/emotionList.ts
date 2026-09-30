// Logique pure de « Ma liste » d'émotions (lot 30), partagée par le formulaire de trade et Paramètres.
// Règle centrale : retirer = archiver (les trades et les statistiques ne changent pas) ; supprimer
// seulement une émotion jamais utilisée. Les règles de fond (unicité, archivage) font foi dans pulse-core.
import type { EmotionCatalogGroup, EmotionUsage, Tag } from '../types/trade'
import { EMOTION_NAME_MAX } from './emotionLimits'

export { EMOTION_NAME_MAX }

const key = (s: string) => s.split(/\s+/).filter(Boolean).join(' ').toLowerCase()

export type CatalogState = 'inList' | 'archived' | 'available'

export interface CatalogEntry {
  name: string
  state: CatalogState
}

export interface CatalogView {
  key: string
  label: string
  entries: CatalogEntry[]
}

const emotionTags = (tags: Tag[]) => tags.filter((t) => t.kind === 'emotion')

/** État de chaque suggestion : déjà dans Ma liste, retirée (elle sera réactivée), ou disponible. */
export function catalogView(groups: readonly EmotionCatalogGroup[], tags: Tag[]): CatalogView[] {
  const byKey = new Map(emotionTags(tags).map((t) => [key(t.name), t]))
  return groups.map((g) => ({
    key: g.key,
    label: g.label,
    entries: g.emotions.map((name) => {
      const tag = byKey.get(key(name))
      return { name, state: tag ? (tag.archived ? 'archived' : 'inList') : 'available' }
    }),
  }))
}

/** Ma liste : les émotions non archivées, dans l'ordre alphabétique. */
export function myList(tags: Tag[]): Tag[] {
  return emotionTags(tags)
    .filter((t) => !t.archived)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

export interface FormEmotion {
  tag: Tag
  /** Retirée de Ma liste mais encore cochée sur ce trade : reste visible. */
  removed: boolean
}

/** Émotions proposées dans le formulaire : Ma liste, plus celles déjà cochées et retirées depuis. */
export function formEmotions(tags: Tag[], selectedIds: Iterable<number>): FormEmotion[] {
  const selected = new Set(selectedIds)
  const kept = emotionTags(tags)
    .filter((t) => t.archived && selected.has(t.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  return [...myList(tags).map((tag) => ({ tag, removed: false })), ...kept.map((tag) => ({ tag, removed: true }))]
}

export type NameProblem = 'empty' | 'tooLong' | 'inList'

/** Contrôle de la saisie libre ; une émotion retirée est acceptée (elle sera réactivée). */
export function nameProblem(input: string, tags: Tag[]): NameProblem | null {
  const cleaned = input.split(/\s+/).filter(Boolean).join(' ')
  if (!cleaned) return 'empty'
  if ([...cleaned].length > EMOTION_NAME_MAX) return 'tooLong'
  if (emotionTags(tags).some((t) => !t.archived && key(t.name) === key(cleaned))) return 'inList'
  return null
}

export interface RemovalChoice {
  tradeCount: number
  /** Suppression définitive possible : jamais utilisée sur aucun trade. */
  canDelete: boolean
}

export function removalChoice(tagId: number, usage: EmotionUsage[]): RemovalChoice {
  const tradeCount = usage.find((u) => u.tagId === tagId)?.tradeCount ?? 0
  return { tradeCount, canDelete: tradeCount === 0 }
}
