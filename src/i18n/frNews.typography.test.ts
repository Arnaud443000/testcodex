import { describe, expect, it } from 'vitest'
import { frNews } from './fr.news'

/** Toutes les chaînes des textes du calendrier, fonctions appelées avec des valeurs d'exemple. */
function strings(value: unknown, path: string, out: [string, string][]) {
  if (typeof value === 'string') out.push([path, value])
  else if (typeof value === 'function') {
    for (const args of [[1, 1], [2, 3], ['X', 'Y']]) {
      let result: unknown
      try {
        result = (value as (...a: unknown[]) => unknown)(...args)
      } catch {
        continue // une fonction qui attend du texte, appelée avec un nombre
      }
      strings(result, `${path}()`, out)
    }
  } else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out))
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out)
  return out
}

describe('typographie des textes du calendrier économique (règle du lot 26)', () => {
  it('espace insécable (U+00A0) avant : ; ? ! % » et après «, jamais une espace ordinaire', () => {
    const bad = strings(frNews, 'news', []).filter(([, s]) => / [:;?!%»]|« /.test(s))
    expect(bad).toEqual([])
  })
})
