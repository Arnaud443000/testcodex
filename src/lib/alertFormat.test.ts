import { describe, expect, it } from 'vitest'
import { fr } from '../i18n/fr'
import type { Alert } from '../types/alerts'
import { alertMessage } from './alertFormat'

const base = { accountId: 1, severity: 'warning', at: 0, tradeId: 7 } as const

describe('texte des alertes à seuils', () => {
  it('pertes consécutives et limites de fréquence', () => {
    expect(alertMessage(fr, { ...base, id: 'a', messageKey: 'consecutiveLosses', kind: 'consecutiveLosses', count: 3, threshold: 3, tradeIds: [5, 6, 7] }))
      .toBe('3 pertes d’affilée aujourd’hui (seuil : 3). Risque de surtrading : faites une pause avant le prochain trade.')
    expect(alertMessage(fr, { ...base, id: 'b', messageKey: 'tradesPerDay.exceeded', kind: 'tradesPerDay', level: 'exceeded', count: 4, threshold: 3, day: '2026-09-29' }))
      .toBe('4 trades pris aujourd’hui : votre maximum de 3 par jour est dépassé.')
    expect(alertMessage(fr, { ...base, id: 'c', messageKey: 'tradesPerWindow.reached', kind: 'tradesPerWindow', level: 'reached', count: 3, threshold: 3, windowMin: 60 }))
      .toBe('3 trades pris en moins de 1 h : votre maximum de 3 est atteint.')
  })

  it('perte du jour : résultat signé (vrai signe moins), part du solde et limites atteintes', () => {
    const a: Alert = {
      ...base, severity: 'critical', id: 'd', messageKey: 'dailyLoss', kind: 'dailyLoss', periodStart: '2026-09-29', currency: 'USD',
      loss: '345', referenceBalance: '11500', lossPct: 0.03, thresholdAmount: '345', thresholdPercent: '3', amountReached: true, percentReached: true,
    }
    expect(alertMessage(fr, a)).toBe(
      'Résultat du jour : −345,00 $ (3,0 % du solde de début de journée). Limite atteinte : 3 % et 345,00 $. Stop pour aujourd’hui.',
    )
    // Sans solde positif, pas de pourcentage.
    expect(alertMessage(fr, { ...a, lossPct: null, percentReached: false, kind: 'weeklyLoss', messageKey: 'weeklyLoss' })).toBe(
      'Résultat de la semaine : −345,00 $. Limite atteinte : 345,00 $. Levez le pied jusqu’à lundi.',
    )
  })

  it('revanche, horaires, session et stop loss', () => {
    expect(alertMessage(fr, { ...base, id: 'e', messageKey: 'revenge', kind: 'revenge', previousTradeId: 1, gapMs: 30 * 60_000, basis: 'risk', ratio: 1.5, sizeFactor: '1.5', windowMin: 60 }))
      .toBe('Trade pris 30 min après une perte, avec une exposition ×1,50 celle du trade perdant (seuil : ×1,5). Risque de trade de revanche.')
    expect(alertMessage(fr, { ...base, id: 'f', messageKey: 'outsideHours', kind: 'outsideHours', localTime: '17:30', tradingHours: '09:00-17:30' }))
      .toBe('Trade entré à 17:30, hors de vos horaires (09:00–17:30).')
    expect(alertMessage(fr, { ...base, id: 'g', messageKey: 'unusualSession', kind: 'unusualSession', session: 'Asie', sessionCount: 1, historyCount: 21, share: 1 / 21 }))
      .toBe('Trade pris en session Asie, où vous tradez rarement (1 sur vos 21 trades précédents, 5 %).')
    expect(alertMessage(fr, { ...base, severity: 'critical', id: 'h', messageKey: 'noStopLoss.open', kind: 'noStopLoss', open: true })).toBe('Position ouverte sans stop loss prévu.')
  })
})
