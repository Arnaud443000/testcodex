import { describe, expect, it } from 'vitest'
import { frProp } from './fr.prop'

function strings(value: unknown, path: string, out: [string, string][]) {
  if (typeof value === 'string') out.push([path, value])
  else if (typeof value === 'function') {
    for (const args of [[1], [0], [2], ['X'], ['X', 'Y', 'Z', 'W', 'V']]) {
      try {
        strings((value as (...a: unknown[]) => unknown)(...args), `${path}()`, out)
      } catch {
        /* fonction qui attend un autre type d'argument */
      }
    }
  } else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out)
  return out
}

describe('typographie des textes du suivi prop firm (lot 33)', () => {
  const all = strings(frProp, 'prop', [])
  it('espace insécable avant : ; ? ! % » et après «, jamais une espace ordinaire', () => {
    expect(all.length).toBeGreaterThan(100)
    expect(all.filter(([, s]) => / [:;?!%»]|« /.test(s))).toEqual([])
  })
  it('vouvoie (aucun « tu », « ton », « ta »)', () => {
    expect(all.filter(([, s]) => /\b(tu|ton|ta|tes)\b/i.test(s))).toEqual([])
  })
  it('jamais d’ordre de ne pas trader, et la règle d’or est écrite', () => {
    expect(all.filter(([, s]) => /ne tradez pas|arrêtez de trader|interdit/i.test(s))).toEqual([])
    expect(frProp.golden.text).toMatch(/trades clôturés seulement/)
    expect(frProp.golden.text).toMatch(/perte latente/)
  })
  it('les exemples de règles sont présentés comme des exemples, sans firme nommée', () => {
    expect(frProp.editor.intro).toMatch(/Par exemple/)
    expect(all.filter(([, s]) => /FTMO|Topstep|The5ers|Apex|FundedNext|MyFundedFX/i.test(s))).toEqual([])
  })
})
