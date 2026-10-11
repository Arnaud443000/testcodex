import { describe, expect, it } from 'vitest'
import { emptyCaseDraft, parseCaseDraft, parseSessionDraft, suggestedResult, emptySessionDraft } from './backtestForm'

describe('saisie d’un cas de backtest', () => {
  it('lit les R à la française et refuse le reste', () => {
    const ok = parseCaseDraft({ ...emptyCaseDraft(), outcome: 'tp', plannedRr: '2,5', resultR: '2,5', maxR: '3' })
    expect(ok.ok && ok.data).toMatchObject({ plannedRr: '2.5', resultR: '2.5', maxR: '3', outcome: 'tp' })
    expect(parseCaseDraft({ ...emptyCaseDraft(), resultR: 'abc' }).ok).toBe(false)
    expect(parseCaseDraft({ ...emptyCaseDraft(), resultR: '' }).ok).toBe(false)
    expect(parseCaseDraft({ ...emptyCaseDraft(), resultR: '2', plannedRr: '0' }).ok).toBe(false)
    expect(parseCaseDraft({ ...emptyCaseDraft(), resultR: '2', maxR: '-1' }).ok).toBe(false)
  })

  it('contrôle le signe selon l’issue et le max R', () => {
    const r = (patch: object) => parseCaseDraft({ ...emptyCaseDraft(), ...patch })
    expect(r({ outcome: 'tp', resultR: '-1' })).toMatchObject({ ok: false, errors: { tpSign: true } })
    expect(r({ outcome: 'sl', resultR: '1' })).toMatchObject({ ok: false, errors: { slSign: true } })
    expect(r({ outcome: 'sl', resultR: '-1' }).ok).toBe(true)
    expect(r({ outcome: 'sl', resultR: '0' }).ok).toBe(true)
    expect(r({ outcome: 'tp', resultR: '2', maxR: '1,5' })).toMatchObject({ ok: false, errors: { maxBelowResult: true } })
  })

  it('une entrée non déclenchée n’a ni résultat ni excursion', () => {
    const r = parseCaseDraft({ ...emptyCaseDraft(), outcome: 'no_entry', resultR: '3', maxR: '4' })
    expect(r.ok && r.data).toMatchObject({ resultR: null, maxR: null })
  })

  it('propose une valeur de départ', () => {
    expect(suggestedResult('sl', '')).toBe('-1')
    expect(suggestedResult('tp', '2,5')).toBe('2.5')
    expect(suggestedResult('tp', '')).toBe('')
    expect(suggestedResult('manual', '2')).toBe('')
  })

  it('exige un nom de session', () => {
    expect(parseSessionDraft(emptySessionDraft()).ok).toBe(false)
    const ok = parseSessionDraft({ ...emptySessionDraft(), name: '  Cassure   NY ' })
    expect(ok.ok && ok.data.name).toBe('Cassure NY')
  })
})
