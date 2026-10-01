import { describe, expect, it } from 'vitest'
import { frAnalysis } from './fr.analysis'

function strings(value: unknown, path: string, out: [string, string][]) {
  if (typeof value === 'string') out.push([path, value])
  else if (typeof value === 'function') {
    for (const args of [[1, 2, 3], [0, 0, 0], [2, 1, 5], ['X', 'Y', 'Z'], [1, 'X', 'Y']]) {
      try {
        strings((value as (...a: unknown[]) => unknown)(...args), `${path}()`, out)
      } catch {
        /* fonction qui attend un autre type d'argument */
      }
    }
  } else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out)
  return out
}

describe('typographie des textes de l’analyse avant trading (lot 31)', () => {
  const all = strings(frAnalysis, 'analysis', [])
  it('espace insécable avant : ; ? ! % » et après «, jamais une espace ordinaire', () => {
    expect(all.length).toBeGreaterThan(200)
    expect(all.filter(([, s]) => / [:;?!%»]|« /.test(s))).toEqual([])
  })
  it('vouvoie (aucun « tu », « ton », « ta »)', () => {
    expect(all.filter(([, s]) => /(?<!\p{L})(tu|ton|ta|tes)(?!\p{L})/iu.test(s))).toEqual([])
  })
  it('n’affirme jamais une cause (« parce que ») et ne reproche rien sur un report', () => {
    expect(all.filter(([, s]) => /parce que|à cause|grâce à/i.test(s))).toEqual([])
    expect(all.filter(([p, s]) => /snooz|Snooz/.test(p) && /encore|toujours pas|trop de fois|déjà/i.test(s))).toEqual([])
  })
})
