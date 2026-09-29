import { beforeAll, describe, expect, it } from 'vitest'
import { mock, mockAi, mockCoach } from './mockBackend'
import { AllowedNumbers, contextLine, simulatedToolPlan, unverifiedNumbers } from './mockCoach'
import type { TradeData } from '../types/trade'

const allowed = (v: unknown) => {
  const a = new AllowedNumbers()
  a.addJson(v)
  return a
}

// Mêmes cas que `coach::numbers::tests` (pulse-core).
describe('contrôle des chiffres (port de pulse-core)', () => {
  it('accepte les valeurs citées, arrondies comme écrites', () => {
    const a = allowed({ winRate: 0.5833, netPnl: '-1234.567', expectancyR: 0.4512, tradeCount: 24 })
    expect(unverifiedNumbers('Sur 24 trades : win rate de 58,3 % (ou 58 %), PnL net de −1 234,57 USD, expectancy de +0,45 R.', a)).toEqual([])
  })
  it('liste une fois un chiffre absent des résultats, et un écart calculé', () => {
    const a = allowed({ winRate: 0.5833, netPnl: '120.5' })
    expect(unverifiedNumbers('Win rate 58,33 %, PnL 120,50 ; vous auriez gagné 42 % de plus, soit 42 % et 350 USD.', a)).toEqual(['42 %', '350'])
    expect(unverifiedNumbers('Écart de 12,4 points.', allowed({ a: 0.62, b: 0.496 }))).toEqual(['12,4'])
  })
  it('ignore dates, heures, années, identifiants et petits entiers', () => {
    const a = new AllowedNumbers()
    expect(unverifiedNumbers('Le 2026-09-22 à 14:30, le 12/09, lundi 22 et le 29 septembre 2026, sur M15 et US30, 3M, 14h, 2 pertes puis 3 trades.', a)).toEqual([])
    expect(unverifiedNumbers('11 trades, 5 %', a)).toEqual(['11', '5 %'])
  })
  it('une fraction correspond à son pourcentage ; les signes sont ignorés', () => {
    const a = allowed({ maxDrawdownPct: 0.1234, delta: '-45.2' })
    expect(unverifiedNumbers('Drawdown max 12,34 %, soit une baisse de 45,2.', a)).toEqual([])
    expect(unverifiedNumbers('Drawdown max 12,5 %', a)).toEqual(['12,5 %'])
  })
  it('les nombres de la question et du contexte sont fournis', () => {
    const a = new AllowedNumbers()
    a.addText("Aujourd'hui : 2026-09-29. Pourquoi je perds 15 % le vendredi ?")
    a.addJson({ day: '2026-09-22', count: 17 })
    expect(unverifiedNumbers('Vous parlez de 15 % ; 17 trades le 22.', a)).toEqual([])
  })
})

describe('contexte et choix simulé des outils', () => {
  it('même ligne de contexte que pulse-core', () => {
    const now = Date.UTC(2026, 8, 29, 12)
    expect(contextLine(now, 120, [1, 3])).toBe("[Contexte ajouté par Pulse] Aujourd'hui : mardi 2026-09-29 (heure locale, UTC+02:00). Comptes de la portée : 1, 3.")
    expect(contextLine(now, -270, [])).toContain('UTC-04:30). Comptes de la portée : aucun.')
  })
  it('choisit des outils selon la question', () => {
    expect(simulatedToolPlan('Résume ma semaine').map((c) => c.name)).toEqual(['period_summary'])
    expect(simulatedToolPlan('Pourquoi je perds le vendredi ?').map((c) => c.name)).toEqual(['segments'])
    expect(simulatedToolPlan('Bonjour').map((c) => c.name)).toEqual(['period_summary'])
  })
})

describe('faux coach : mêmes garde-fous que pulse-ai, sans réseau', () => {
  const DAY = 86_400_000
  let account = 0
  beforeAll(async () => {
    account = (await mock.createAccount({ name: 'Coach SECRET', kind: 'personal', broker: 'SECRET', currency: 'USD', initialCapital: '10000' })).id
    const ins = (await mock.createInstrument({ symbol: 'COACHTEST', name: '', assetClass: 'other', defaultMultiplier: '1' })).id
    for (const exit of ['110', '95']) {
      const t: TradeData = {
        accountId: account, instrumentId: ins, direction: 'long', size: '1', multiplier: '1', entryPrice: '100', exitPrice: exit,
        entryTime: Date.now() - DAY - 3_600_000, exitTime: Date.now() - DAY, tzOffsetMin: 0, plannedSl: '90', fees: '0',
        thesis: 'SECRET thèse', postMortem: 'SECRET notes', tagIds: [], emotions: [], ruleChecks: [], checklist: [],
      }
      await mock.createTrade(t)
    }
  })
  const ask = (question: string, conversationId: number | null = null, confirmed = true) =>
    mockCoach.askCoach({ conversationId, question, accountIds: [account], tzOffsetMin: 0, confirmed })

  it('refuse tant que l’IA est éteinte, sans consentement, sans validation ou sans clé', async () => {
    await expect(ask('Résume ma semaine')).rejects.toThrow('ai:disabled')
    await mockAi.setAiSettings({ enabled: true, model: 'claude-opus-5-5' })
    await mockAi.recordAiConsent()
    await expect(ask('Résume ma semaine')).rejects.toThrow('ai:consentRequired')
    await mockCoach.recordCoachConsent()
    await expect(ask('Résume ma semaine', null, false)).rejects.toThrow('ai:consentRequired')
    await expect(ask('   ')).rejects.toThrow('ai:questionInvalid')
    await expect(ask('x'.repeat(2001))).rejects.toThrow('ai:questionInvalid')
    await expect(ask('Résume ma semaine')).rejects.toThrow('ai:noKey')
    expect(await mockCoach.listCoachConversations()).toEqual([])
  })

  it('répond en simulation, journalise ce qui part et repère les chiffres inventés', async () => {
    await mockAi.saveAiKey('sk-test-key')
    const turn = await ask('Résume ma semaine')
    expect(turn.provider).toBe('simulation')
    expect(turn.answer).toMatch(/^\[Simulation\]/)
    expect(turn.sent.context).toContain(`Comptes de la portée : ${account}.`)
    expect(turn.sent.toolCalls[0].name).toBe('period_summary')
    expect((turn.sent.toolCalls[0].output as any).summary.tradeCount).toBe(2)
    expect(turn.unverified).toEqual(['42 %'])
    expect(JSON.stringify(turn.sent)).not.toContain('SECRET')

    const next = await ask('Et le vendredi ?', turn.conversationId)
    expect(next.seq).toBe(2)
    expect(next.sent.historyTurns).toBe(1)
    const status = await mockCoach.getCoachStatus()
    expect(status.tools.map((t) => t.name)).toHaveLength(13)
    expect(status.limits.maxTurns).toBe(20)
  })

  it('renomme, supprime une conversation ou toutes', async () => {
    const t = await ask('Mes erreurs les plus coûteuses ?')
    expect((await mockCoach.renameCoachConversation(t.conversationId, '  Erreurs  ')).title).toBe('Erreurs')
    await expect(mockCoach.renameCoachConversation(t.conversationId, '  ')).rejects.toThrow()
    await mockCoach.deleteCoachConversation(t.conversationId)
    await expect(mockCoach.getCoachConversation(t.conversationId)).rejects.toThrow()
    expect(await mockCoach.deleteAllCoachConversations()).toBeGreaterThan(0)
    expect(await mockCoach.listCoachConversations()).toEqual([])
  })

  it('une conversation pleine ne prend plus de question ; éteindre l’IA oublie le consentement', async () => {
    const first = await ask('Q0')
    for (let i = 1; i < 20; i++) await ask(`Q${i}`, first.conversationId)
    const summary = (await mockCoach.listCoachConversations())[0]
    expect(summary.full).toBe(true)
    await expect(ask('Encore', first.conversationId)).rejects.toThrow('ai:conversationClosed')
    await mockAi.setAiSettings({ enabled: false, model: 'claude-opus-5-5' })
    expect((await mockCoach.getCoachStatus()).consentAt).toBeNull()
  }, 30_000)
})
