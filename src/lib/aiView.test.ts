import { describe, expect, it } from 'vitest'
import { aiErrorCode, formatBytes, parseAnalysis, splitNotes } from './aiView'

describe('affichage de l’IA', () => {
  it('découpe la réponse en titres, puces et paragraphes, sans interpréter de HTML', () => {
    const blocks = parseAnalysis(
      '[Simulation] test\n\n## Contexte visible\n- Tendance **haussière**.\n* Range\n1. Point\n## Incohérences relevées\n<b>Aucune</b> incohérence nette.\n#\n',
    )
    expect(blocks).toEqual([
      { kind: 'paragraph', text: '[Simulation] test' },
      { kind: 'heading', text: 'Contexte visible' },
      { kind: 'bullet', text: 'Tendance haussière.' },
      { kind: 'bullet', text: 'Range' },
      { kind: 'bullet', text: 'Point' },
      { kind: 'heading', text: 'Incohérences relevées' },
      { kind: 'paragraph', text: '<b>Aucune</b> incohérence nette.' },
      { kind: 'paragraph', text: '#' },
    ])
    expect(parseAnalysis('')).toEqual([])
  })

  it('reconnaît les codes d’erreur de l’IA, quelle que soit leur forme', () => {
    expect(aiErrorCode('ai:invalidKey')).toBe('invalidKey')
    expect(aiErrorCode(new Error('ai:rateLimited'))).toBe('rateLimited')
    expect(aiErrorCode('Error: ai:vaultUnavailable')).toBe('vaultUnavailable')
    expect(aiErrorCode('not found: trade 3')).toBeNull()
  })

  it('écrit les tailles à la française', () => {
    expect(formatBytes(850_000)).toBe('850 ko')
    expect(formatBytes(1_234_567)).toBe('1,2 Mo')
    expect(formatBytes(12)).toBe('1 ko')
  })

  it('garde le plus récent à part', () => {
    expect(splitNotes([3, 2, 1])).toEqual({ latest: 3, older: [2, 1] })
    expect(splitNotes([])).toEqual({ latest: null, older: [] })
  })
})
