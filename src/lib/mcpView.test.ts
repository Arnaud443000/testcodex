import { describe, expect, it } from 'vitest'
import { fr } from '../i18n/fr'
import { enableBlocker, formChanged, formFromSettings, mcpErrorCode, mcpErrorMessage, mixedCurrencies, paramsSummary, toggleAccount } from './mcpView'
import type { McpStatus } from '../types/mcp'

const status = (patch: Partial<McpStatus> = {}): McpStatus => ({
  settings: { consentAt: null, accountIds: [], duration: 'untilClose', autostart: false },
  active: false,
  startedAt: null,
  expiresAt: null,
  calls: 0,
  refused: 0,
  lastCallAt: null,
  lastStopReason: null,
  lastStopAt: null,
  cannotEnable: 'consentRequired',
  logCount: 0,
  ...patch,
})

describe('affichage de l’accès MCP (lot 37)', () => {
  it('codes d’erreur traduits, jamais le texte brut quand le code est connu', () => {
    expect(mcpErrorCode(new Error('invalid input: mcp:noAccount'))).toBe('noAccount')
    expect(mcpErrorCode('lock:locked')).toBe('locked')
    expect(mcpErrorCode('boom')).toBeNull()
    expect(mcpErrorMessage('invalid input: mcp:consentRequired', fr.mcp)).toBe(fr.mcp.errors.consentRequired)
    expect(mcpErrorMessage('lock:locked', fr.mcp, 'Verrouillé')).toBe('Verrouillé')
    expect(mcpErrorMessage(new Error('invalid input: autre chose'), fr.mcp)).toBe(fr.mcp.unknownError('autre chose'))
    for (const code of ['consentRequired', 'noAccount', 'invalidAccount', 'tooManyCalls', 'random']) expect(fr.mcp.errors[code]).toBeTruthy()
  })

  it('comptes cochés : triés, sans doublon, archivés retirés du formulaire', () => {
    expect(toggleAccount([3, 1], 2, true)).toEqual([1, 2, 3])
    expect(toggleAccount([1, 2], 2, true)).toEqual([1, 2])
    expect(toggleAccount([1, 2], 1, false)).toEqual([2])
    const form = formFromSettings({ consentAt: 1, accountIds: [1, 7], duration: '4h', autostart: true }, [1, 2])
    expect(form).toEqual({ accountIds: [1], duration: '4h', autostart: true })
    expect(formChanged({ consentAt: 1, accountIds: [1], duration: '4h', autostart: true }, form)).toBe(false)
    expect(formChanged({ consentAt: 1, accountIds: [1], duration: '1h', autostart: true }, form)).toBe(true)
  })

  it('activer demande la case de consentement puis un compte', () => {
    const form = { accountIds: [], duration: 'untilClose' as const, autostart: false }
    expect(enableBlocker(status(), false, form)).toBe('consentRequired')
    expect(enableBlocker(status(), true, form)).toBe('noAccount')
    expect(enableBlocker(status(), true, { ...form, accountIds: [1] })).toBeNull()
    expect(enableBlocker(status({ settings: { consentAt: 5, accountIds: [1], duration: 'untilClose', autostart: false } }), false, { ...form, accountIds: [1] })).toBeNull()
  })

  it('paramètres résumés, devises mélangées signalées', () => {
    expect(paramsSummary('{}', 'aucun')).toBe('aucun')
    expect(paramsSummary('{"period":"1S"}', 'aucun')).toBe('{"period":"1S"}')
    expect(paramsSummary(`{"x":"${'a'.repeat(100)}"}`, 'aucun', 20)).toHaveLength(20)
    const accounts = [{ id: 1, currency: 'USD' }, { id: 2, currency: 'EUR' }, { id: 3, currency: 'USD' }]
    expect(mixedCurrencies(accounts, [1, 3])).toBe(false)
    expect(mixedCurrencies(accounts, [1, 2])).toBe(true)
  })

  it('textes : 13 outils nommés, durées, raisons d’arrêt', () => {
    expect(Object.keys(fr.mcp.toolLabels)).toHaveLength(13)
    expect(Object.keys(fr.mcp.durations)).toEqual(['untilClose', '1h', '4h'])
    for (const r of ['manual', 'expired', 'locked', 'closed', 'settings']) expect(fr.mcp.stopReasons[r]).toBeTruthy()
    expect(fr.mcp.bytes(850)).toBe('850\u00a0o')
    expect(fr.mcp.bytes(1500)).toBe('1,5\u00a0ko')
  })
})
