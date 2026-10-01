// Faux backend de « Ma liste » d'émotions (lot 30) : miroir de crates/pulse-core/src/emotions.rs
// (mêmes règles, mêmes messages). Fonctions pures sur les tableaux du faux backend.
import type { EmotionUsage, Tag } from '../types/trade'

import { EMOTION_NAME_MAX } from './emotionLimits'

const invalid = (m: string) => new Error(`invalid input: ${m}`)
const clean = (s: string) => s.split(/\s+/).filter(Boolean).join(' ')
const key = (s: string) => clean(s).toLowerCase()

type Ctx = { tags: Tag[]; trades: Iterable<{ emotions: { tagId: number }[] }>; nextId: () => number }

function emotion(tags: Tag[], id: number): Tag {
  const tag = tags.find((g) => g.id === id)
  if (!tag) throw new Error(`not found: tag ${id}`)
  if (tag.kind !== 'emotion') throw invalid(`tag ${tag.name} is not an emotion`)
  return tag
}

/** Crée l'émotion, ou la réactive si elle était archivée ; jamais de doublon (casse et espaces ignorés). */
export function addEmotionToList({ tags, nextId }: Ctx, name: string): Tag {
  const cleaned = clean(name)
  if (!cleaned) throw invalid('emotion name is required')
  if ([...cleaned].length > EMOTION_NAME_MAX) throw invalid(`emotion name is limited to ${EMOTION_NAME_MAX} characters`)
  const existing = tags.find((g) => g.kind === 'emotion' && key(g.name) === key(cleaned))
  if (existing) {
    existing.archived = false
    return existing
  }
  const tag: Tag = { id: nextId(), kind: 'emotion', name: cleaned, archived: false }
  tags.push(tag)
  return tag
}

/** Retirer = archiver : les trades et les statistiques ne changent pas. */
export function removeEmotionFromList({ tags }: Ctx, id: number): Tag {
  const tag = emotion(tags, id)
  tag.archived = true
  return tag
}

export function emotionUsage({ tags, trades }: Ctx): EmotionUsage[] {
  const counts = new Map<number, number>()
  for (const t of trades) for (const id of new Set(t.emotions.map((e) => e.tagId))) counts.set(id, (counts.get(id) ?? 0) + 1)
  return tags.filter((g) => g.kind === 'emotion').map((g) => ({ tagId: g.id, tradeCount: counts.get(g.id) ?? 0 }))
}

/** Suppression définitive d'une émotion jamais utilisée ; refus sinon. */
export function deleteUnusedEmotion(ctx: Ctx, id: number): void {
  const tag = emotion(ctx.tags, id)
  const used = emotionUsage(ctx).find((u) => u.tagId === id)?.tradeCount ?? 0
  if (used > 0) throw invalid(`emotion ${tag.name} is used on ${used} trade emotion(s): remove it from the list instead of deleting it`)
  ctx.tags.splice(ctx.tags.indexOf(tag), 1)
}
