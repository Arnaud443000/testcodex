import { describe, expect, it } from 'vitest'
import { mistakeLink, parseMistakeParam } from './mistakeFilter'

describe('filtre par erreur dans l’adresse', () => {
  it('fait l’aller-retour pour une étiquette et pour une règle', () => {
    for (const m of [{ source: 'tag', id: 12 }, { source: 'rule', id: 3 }] as const) {
      const value = mistakeLink(m).split('=')[1]
      expect(parseMistakeParam(value)).toEqual(m)
    }
    expect(mistakeLink({ source: 'rule', id: 3 })).toBe('/trades?mistake=rule:3')
  })

  it('ignore une valeur absente ou mal formée', () => {
    for (const bad of [null, '', 'tag', 'tag:', 'tag:x', 'setup:1', 'rule:-1', 'tag:1;drop']) expect(parseMistakeParam(bad)).toBeNull()
  })
})
