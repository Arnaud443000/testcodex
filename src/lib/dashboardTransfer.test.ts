import { describe, expect, it } from 'vitest'
import { configFileName, parseImportError } from './dashboardTransfer'

describe('configFileName', () => {
  it('donne un nom de fichier sûr, sans accents ni caractères interdits', () => {
    expect(configFileName('Prop firm')).toBe('pulse-dashboard-prop-firm.json')
    expect(configFileName('Été / Suivi : « Test »?')).toBe('pulse-dashboard-ete-suivi-test.json')
    expect(configFileName('***')).toBe('pulse-dashboard-export.json')
    expect(configFileName('x'.repeat(100)).length).toBeLessThanOrEqual('pulse-dashboard-.json'.length + 40)
  })
})

describe('parseImportError', () => {
  it('lit le code et le détail des erreurs de pulse-core', () => {
    expect(parseImportError('invalid input: dashboard_import:empty')).toEqual({ code: 'empty', detail: null })
    expect(parseImportError('invalid input: dashboard_import:too_new:2')).toEqual({ code: 'too_new', detail: '2' })
    expect(parseImportError('invalid input: dashboard_import:corrupt:expected value at line 1 column 2')).toEqual({
      code: 'corrupt',
      detail: 'expected value at line 1 column 2',
    })
    expect(parseImportError('invalid input: dashboard_import:invalid:invalid input: widgets "a" and "b" overlap')?.code).toBe('invalid')
  })

  it('renvoie null pour toute autre erreur (fichier introuvable…) et pour un code inconnu', () => {
    expect(parseImportError('io error: No such file or directory (os error 2)')).toBeNull()
    expect(parseImportError('invalid input: dashboard_import:from_the_future')).toBeNull()
  })
})
