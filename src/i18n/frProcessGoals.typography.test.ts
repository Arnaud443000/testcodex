import { describe, expect, it } from 'vitest'
import { frProcessGoals } from './fr.processGoals'

function strings(value: unknown, path: string, out: [string, string][]) {
  if (typeof value === 'string') out.push([path, value])
  else if (typeof value === 'function') {
    for (const args of [[1], [0], [2], ['X']]) {
      try {
        strings((value as (...a: unknown[]) => unknown)(...args), `${path}()`, out)
      } catch {
        /* fonction qui attend un autre type d'argument */
      }
    }
  } else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out)
  return out
}

describe('typographie des textes des objectifs de comportement (lot 34)', () => {
  it('espace insécable avant : ; ? ! % » et après «, jamais une espace ordinaire', () => {
    const all = strings(frProcessGoals, 'processGoals', [])
    expect(all.length).toBeGreaterThan(30)
    expect(all.filter(([, s]) => / [:;?!%»]|« /.test(s))).toEqual([])
  })
  it('vouvoie (aucun « tu », « ton », « ta »)', () => {
    expect(strings(frProcessGoals, 'processGoals', []).filter(([, s]) => /\b(tu|ton|ta|tes)\b/i.test(s))).toEqual([])
  })
})
