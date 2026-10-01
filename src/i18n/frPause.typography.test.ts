import { describe, expect, it } from 'vitest'
import { frPause } from './fr.pause'

function strings(value: unknown, path: string, out: [string, string][]) {
  if (typeof value === 'string') out.push([path, value])
  else if (typeof value === 'function') {
    for (const args of [[1], [0], [2], ['X'], [5, 7, 3], ['X', 'Y']]) {
      try {
        strings((value as (...a: unknown[]) => unknown)(...args), `${path}()`, out)
      } catch {
        /* fonction qui attend un autre type d'argument */
      }
    }
  } else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out)
  return out
}
const all = strings(frPause, 'pause', [])

describe('textes de la pause volontaire (lot 35)', () => {
  it('espace insécable avant : ; ? ! % » et après «, jamais une espace ordinaire', () => {
    expect(all.length).toBeGreaterThan(60)
    expect(all.filter(([, s]) => / [:;?!%»]|« /.test(s))).toEqual([])
  })
  it('vouvoie (aucun « tu », « ton », « ta »)', () => {
    expect(all.filter(([, s]) => /(?<![\p{L}])(tu|ton|ta|tes)(?![\p{L}])/iu.test(s))).toEqual([])
  })
  it('jamais « parce que », jamais d’ordre ni de reproche', () => {
    expect(all.filter(([, s]) => /parce que|à cause de|vous devez|il faut arrêter|interdit|faute|coupable|honte|échec/i.test(s))).toEqual([])
  })
  it('dit que la pause est un rappel et que rien n’est bloqué', () => {
    expect(frPause.picker.intro).toMatch(/Rien n’est bloqué/)
    expect(frPause.form.reassure).toMatch(/rappel/)
  })
})
