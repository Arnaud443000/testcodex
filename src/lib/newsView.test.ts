import { describe, expect, it } from 'vitest'
import { fr } from '../i18n/fr'
import { countdown, groupByDay, importanceBars, newsErrorMessage, toggle, valueCells, widgetImportances } from './newsView'
import type { EconomicEvent } from '../types/news'

const t = fr.news
const ev = (over: Partial<EconomicEvent>): EconomicEvent => ({
  id: 1, source: 'file', startsAt: null, day: '2026-09-29', parisTime: null, weekday: 2, currency: 'USD', title: 'CPI', importance: 'high',
  forecast: null, previous: null, actual: null, updatedAt: 0, ...over,
})

describe('affichage du calendrier économique', () => {
  it('traduit chaque code news: renvoyé par pulse-core ou pulse-news', () => {
    expect(newsErrorMessage(new Error('invalid input: news:tooSoon'), t)).toBe(t.errors.tooSoon)
    expect(newsErrorMessage('news:offline', t)).toBe(t.errors.offline)
    expect(newsErrorMessage('news:redirected', t)).toContain('redirections')
    expect(newsErrorMessage('boom', t)).toBe(t.errors.unknown('boom'))
    expect(newsErrorMessage('news:neverSeen', t)).toBe(t.errors.unknown('news:neverSeen'))
    // Chaque code de pulse-core (settings, store, ics, csv) et de pulse-news a son texte.
    for (const code of ['disabled', 'noSource', 'tooSoon', 'urlNotHttps', 'urlWithCredentials', 'invalidUrl', 'invalidWindow', 'invalidCurrency',
      'invalidRange', 'fileTooLarge', 'fileUnreadable', 'notIcs', 'csvHeader', 'offline', 'timeout', 'redirected', 'forbidden', 'notFound',
      'rateLimited', 'rejected', 'serverError', 'tooLarge', 'empty', 'unexpectedResponse']) {
      expect(typeof (t.errors as unknown as Record<string, unknown>)[code], code).toBe('string')
    }
  })

  it('importance : texte et forme', () => {
    expect([importanceBars('high'), importanceBars('medium'), importanceBars('low')]).toEqual([3, 2, 1])
    expect([t.importance.high, t.importance.medium, t.importance.low]).toEqual(['Forte', 'Moyenne', 'Faible'])
  })

  it('regroupe par jour sans réordonner', () => {
    const g = groupByDay([ev({ id: 1, day: '2026-09-29' }), ev({ id: 2, day: '2026-09-29' }), ev({ id: 3, day: '2026-09-30' })])
    expect(g.map((x) => [x.day, x.events.map((e) => e.id)])).toEqual([['2026-09-29', [1, 2]], ['2026-09-30', [3]]])
  })

  it('décompte avant la news', () => {
    const now = Date.UTC(2026, 8, 29, 10)
    expect(countdown(ev({ startsAt: now + (2 * 60 + 15) * 60_000 }), now, t)).toBe('dans 2 h 15 min')
    expect(countdown(ev({ startsAt: now + 30_000 }), now, t)).toBe('en cours')
    expect(countdown(ev({ startsAt: null }), now, t)).toBe('aujourd’hui')
  })

  it('filtres, modes du widget et valeurs', () => {
    expect(toggle(['USD'], 'EUR')).toEqual(['USD', 'EUR'])
    expect(toggle(['USD', 'EUR'], 'USD')).toEqual(['EUR'])
    expect([widgetImportances(null), widgetImportances('high'), widgetImportances('all')]).toEqual([['medium', 'high'], ['high'], []])
    expect(valueCells(ev({ forecast: '0,3 %', actual: '0,4 %' }))).toEqual(['0,3 %', '—', '0,4 %'])
  })
})
