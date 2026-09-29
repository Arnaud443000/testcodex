import { compareDecimal } from './decimal'
import type { Outcome, Tag, TagKind, TradeView } from '../types/trade'

export interface ListFilters {
  instrumentId: number | null
  setupTagId: number | null
  sessionTagId: number | null
  /** 'open' = trade encore ouvert. */
  outcome: Outcome | 'open' | null
}

export const NO_FILTERS: ListFilters = { instrumentId: null, setupTagId: null, sessionTagId: null, outcome: null }

export function hasActiveFilters(f: ListFilters): boolean {
  return f.instrumentId !== null || f.setupTagId !== null || f.sessionTagId !== null || f.outcome !== null
}

export function applyFilters(trades: TradeView[], f: ListFilters): TradeView[] {
  return trades.filter(
    (t) =>
      (f.instrumentId === null || t.instrumentId === f.instrumentId) &&
      (f.setupTagId === null || t.tagIds.includes(f.setupTagId)) &&
      (f.sessionTagId === null || t.tagIds.includes(f.sessionTagId)) &&
      (f.outcome === null || (f.outcome === 'open' ? t.figures === null : t.figures?.outcome === f.outcome)),
  )
}

export type SortKey = 'date' | 'symbol' | 'direction' | 'pnl' | 'r' | 'duration'
export type SortDir = 'asc' | 'desc'

/** Valeur triable d'une colonne ; null = absente (trade ouvert, pas de stop…), toujours classée en dernier. */
function sortValue(t: TradeView, key: SortKey): string | number | null {
  switch (key) {
    case 'date':
      return t.entryTime
    case 'symbol':
      return t.symbol.toLowerCase()
    case 'direction':
      return t.direction
    case 'pnl':
      return t.figures?.netPnl ?? null
    case 'r':
      return t.figures?.rMultiple ?? null
    case 'duration':
      return t.durationMs
  }
}

function compareValues(a: string | number, b: string | number, key: SortKey): number {
  if (key === 'pnl') return compareDecimal(a as string, b as string)
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, 'fr')
  return (a as number) - (b as number)
}

export function sortTrades(trades: TradeView[], key: SortKey, dir: SortDir): TradeView[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...trades].sort((x, y) => {
    const a = sortValue(x, key)
    const b = sortValue(y, key)
    if (a === null && b === null) return y.id - x.id
    if (a === null) return 1
    if (b === null) return -1
    return sign * compareValues(a, b, key) || y.id - x.id
  })
}

/** Le premier tag d'un genre porté par le trade (setup, session, timeframe…). */
export function tagOfKind(t: TradeView, tags: Tag[], kind: TagKind): Tag | undefined {
  return tags.find((g) => g.kind === kind && t.tagIds.includes(g.id))
}

/**
 * « À compléter » (cahier 3.1.7) : un trade saisi en Quick add reste incomplet tant que
 * sa thèse ou ses émotions manquent. La checklist n'entre pas dans le test : sans modèle
 * de checklist, elle ne peut pas être remplie.
 */
export function isIncomplete(t: TradeView): boolean {
  return t.thesis.trim() === '' || t.emotions.length === 0
}
