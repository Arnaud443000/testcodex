import { describe, expect, it } from 'vitest'
import source from '../../crates/pulse-core/catalog/emotions.txt?raw'
import { EMOTION_CATALOG } from './emotionCatalog'

const name = (s: string) => s.split(/\s+/).filter(Boolean).join(' ').toLowerCase()

/** Relit le fichier source partagé avec pulse-core (même format que emotions.rs). */
function sourceFile() {
  const groups: { key: string; label: string; emotions: string[] }[] = []
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('@')) {
      const [key, label] = line.slice(1).split('|').map((x: string) => x.trim())
      groups.push({ key, label, emotions: [] })
    } else groups[groups.length - 1].emotions.push(line)
  }
  return groups
}

describe('catalogue d’émotions', () => {
  it('est identique au fichier lu par pulse-core', () => {
    expect(EMOTION_CATALOG).toEqual(sourceFile())
  })

  it('ne contient aucun doublon (casse et espaces ignorés), une famille non vide, des noms courts', () => {
    const all = EMOTION_CATALOG.flatMap((g) => g.emotions)
    expect(all.length).toBeGreaterThanOrEqual(40)
    expect(new Set(all.map(name)).size).toBe(all.length)
    expect(new Set(EMOTION_CATALOG.map((g) => g.key)).size).toBe(EMOTION_CATALOG.length)
    for (const g of EMOTION_CATALOG) expect(g.emotions.length).toBeGreaterThan(0)
    for (const e of all) expect([...e].length).toBeLessThanOrEqual(40)
  })
})
