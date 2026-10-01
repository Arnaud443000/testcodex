import { describe, expect, it } from 'vitest'
import { checkUrl, createNewsMock, parisDay, parisHhmm, parisOffsetMin, parisToUtc, parisWeek, simulatedEvents } from './mockNews'
import type { NewsSettings } from '../types/news'

const at = (iso: string) => Date.parse(iso)
const dayNum = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000
const code = (p: Promise<unknown>) => p.then(() => 'OK', (e: Error) => e.message)

describe('heure de Paris (même règle que pulse_core::news::zones)', () => {
  it('passe à l’heure d’été le dernier dimanche de mars à 01:00 UTC', () => {
    expect(parisOffsetMin(at('2026-03-29T00:59:00Z'))).toBe(60)
    expect(parisHhmm(at('2026-03-29T00:59:00Z'))).toBe('01:59')
    expect(parisOffsetMin(at('2026-03-29T01:00:00Z'))).toBe(120)
    expect(parisHhmm(at('2026-03-29T01:00:00Z'))).toBe('03:00')
  })
  it('revient à l’heure d’hiver le dernier dimanche d’octobre à 01:00 UTC', () => {
    expect(parisOffsetMin(at('2026-10-25T00:59:00Z'))).toBe(120)
    expect(parisHhmm(at('2026-10-25T00:59:00Z'))).toBe('02:59')
    expect(parisOffsetMin(at('2026-10-25T01:00:00Z'))).toBe(60)
    expect(parisHhmm(at('2026-10-25T01:00:00Z'))).toBe('02:00')
    expect(parisOffsetMin(at('2025-10-26T01:30:00Z'))).toBe(60)
  })
  it('lit une heure de Paris : trou du printemps, heure répétée de l’automne', () => {
    expect(parisToUtc(dayNum('2026-03-29'), 2 * 60 + 30)).toBeNull()
    expect(parisToUtc(dayNum('2026-10-25'), 2 * 60 + 30)).toBe(at('2026-10-25T00:30:00Z'))
    expect(parisToUtc(dayNum('2026-07-01'), 14 * 60 + 30)).toBe(at('2026-07-01T12:30:00Z'))
    expect(parisToUtc(dayNum('2026-01-01'), 14 * 60 + 30)).toBe(at('2026-01-01T13:30:00Z'))
  })
  it('jour et semaine de Paris', () => {
    expect(parisDay(at('2026-07-14T22:30:00Z'))).toBe('2026-07-15')
    expect(parisWeek(at('2026-09-29T10:00:00Z'))).toEqual(['2026-09-28', '2026-10-04'])
    expect(parisWeek(at('2026-10-04T22:30:00Z'))[0]).toBe('2026-10-05')
  })
})

describe('adresse du flux (mêmes règles que check_url)', () => {
  it('refuse ce que pulse-core refuse', () => {
    const c = (u: string) => {
      try {
        return checkUrl(u)
      } catch (e) {
        return (e as Error).message
      }
    }
    expect(c('http://example.org/a.ics')).toBe('news:urlNotHttps')
    expect(c('https://user:pw@example.org/a.ics')).toBe('news:urlWithCredentials')
    expect(c('https://exa mple.org/a.ics')).toBe('news:invalidUrl')
    expect(c('https:///a.ics')).toBe('news:invalidUrl')
    expect(c(`https://example.org/${'a'.repeat(2100)}`)).toBe('news:invalidUrl')
    expect(c('https://Calendar.example.org:8443/eco.ics?week=this')).toBe('calendar.example.org')
  })
})

describe('faux calendrier', () => {
  const NOW = at('2026-09-29T10:00:00Z')
  const feed: NewsSettings = {
    enabled: true,
    source: 'icsUrl',
    icsUrl: 'https://calendar.example.org/eco.ics',
    icsImportance: 'medium',
    icsCurrency: null,
    ffConsent: false,
    windowBeforeMin: 15,
    windowAfterMin: 15,
    alert: true,
  }

  it('est désactivé par défaut, sans source en ligne', async () => {
    const m = createNewsMock(() => NOW)
    const s = await m.getNewsStatus()
    expect([s.settings.enabled, s.settings.source, s.settings.icsUrl, s.eventCount]).toEqual([false, 'none', null, 0])
    expect(await m.refreshNews(false)).toMatchObject({ fetched: false })
    expect(await code(m.refreshNews(true))).toBe('news:disabled')
    expect(await code(m.importNewsFile('ics', 'x.ics', { importance: 'medium', currency: null }))).toBe('news:disabled')
    await m.setNewsSettings({ ...feed, source: 'none', icsUrl: null })
    expect(await code(m.refreshNews(true))).toBe('news:noSource')
    expect(await code(m.setNewsSettings({ ...feed, icsUrl: null }))).toBe('news:noSource')
    expect(await code(m.setNewsSettings({ ...feed, windowAfterMin: 241 }))).toBe('news:invalidWindow')
    expect(await code(m.setNewsSettings({ ...feed, icsCurrency: 'XYZ' }))).toBe('news:invalidCurrency')
  })

  it('une fois par jour à l’ouverture, jamais deux fois en 5 minutes', async () => {
    let t = NOW
    const m = createNewsMock(() => t)
    await m.setNewsSettings(feed)
    const first = await m.refreshNews(false)
    expect(first.fetched).toBe(true)
    expect(first.status.state.lastSuccessAt).toBe(NOW)
    t = NOW + 6 * 3_600_000
    expect((await m.refreshNews(false)).fetched).toBe(false)
    t = NOW + 4 * 60_000
    expect(await code(m.refreshNews(true))).toBe('news:tooSoon')
    t = NOW + 5 * 60_000
    expect((await m.refreshNews(true)).fetched).toBe(true)
  })

  it('événements simulés en heure de Paris, ordonnés, filtrés', async () => {
    const m = createNewsMock(() => NOW)
    await m.setNewsSettings({ ...feed, source: 'none', icsUrl: null })
    const s = await m.importNewsFile('csv', 'simulation.csv', { importance: 'high', currency: null })
    expect(s.added).toBe(simulatedEvents(NOW).length)
    const week = await m.getNewsCalendar('week', { importances: [], currencies: [] })
    expect([week.fromDay, week.toDay, week.today]).toEqual(['2026-09-28', '2026-10-04', '2026-09-29'])
    expect(week.events.every((e) => e.source === 'simulation')).toBe(true)
    const days = week.events.map((e) => e.day)
    expect([...days].sort()).toEqual(days)
    const today = await m.getNewsCalendar('today', { importances: ['high'], currencies: [] })
    expect(today.events.map((e) => [e.parisTime, e.currency, e.title])).toEqual([['11:00', 'EUR', 'Inflation de la zone euro (estimation flash)']])
    // 11:00 Paris = 09:00 UTC, already past at 10:00 UTC: its actual value is known.
    expect(today.events[0].actual).toBe('2,1 %')
    const usd = await m.getNewsCalendar('week', { importances: [], currencies: ['usd'] })
    expect(usd.events.every((e) => e.currency === 'USD')).toBe(true)
    const next = await m.getUpcomingNews(3, [])
    expect(next[0].title).toBe("Offres d'emploi JOLTS")
    expect(next.every((e) => e.startsAt == null || e.startsAt >= NOW)).toBe(true)
    expect(await m.clearNewsEvents()).toBe(s.added)
  })

  const ff: NewsSettings = { ...feed, source: 'forexFactory', icsUrl: null, ffConsent: true }

  it('Forex Factory : consentement exigé, hôte unique, simulation', async () => {
    const m = createNewsMock(() => NOW)
    await m.setNewsSettings({ ...feed, source: 'none', icsUrl: null })
    expect(await code(m.setNewsSettings({ ...ff, ffConsent: false }))).toBe('news:consentRequired')
    expect((await m.getNewsStatus()).settings.source).toBe('none')
    const st = await m.setNewsSettings(ff)
    expect([st.onlineReady, st.onlineHost, st.settings.ffConsent]).toEqual([true, 'nfs.faireconomy.media', true])
    const r = await m.refreshNews(false)
    expect(r.fetched).toBe(true)
    const week = await m.getNewsCalendar('week', { importances: [], currencies: [] })
    expect(week.events.length).toBeGreaterThan(0)
    expect(week.events.every((e) => e.source === 'simulation')).toBe(true)
    expect(week.events.every((e) => e.actual === null)).toBe(true) // aucune valeur réelle chez Forex Factory
    // Quitter la source efface ses événements (pas ceux d'un fichier).
    await m.importNewsFile('csv', 'x.csv', { importance: 'medium', currency: null })
    await m.setNewsSettings({ ...ff, source: 'none' })
    expect((await m.getNewsStatus()).eventCount).toBe(simulatedEvents(NOW).length)
  })

  it('« Tester la source » n’enregistre rien avant confirmation et respecte le délai de 5 min', async () => {
    let t = NOW
    const m = createNewsMock(() => t)
    await m.setNewsSettings({ ...feed, source: 'none', icsUrl: null })
    expect(await code(m.testNewsSource({ ...ff, ffConsent: false }))).toBe('news:consentRequired')
    expect(await code(m.testNewsSource({ ...ff, source: 'none' }))).toBe('news:noSource')
    const p = await m.testNewsSource(ff)
    expect(p.count).toBe(simulatedEvents(NOW).length)
    // Mardi 12:00 à Paris : l'inflation de 11:00 est passée ; puis mercredi.
    expect(p.events.map((e) => [e.day, e.parisTime, e.title])).toEqual([
      ['2026-09-29', '16:00', "Offres d'emploi JOLTS"],
      ['2026-09-30', '14:15', 'Emplois privés ADP'],
      ['2026-09-30', '16:30', 'Stocks de pétrole brut'],
    ])
    expect(p.events.every((e) => e.day >= '2026-09-29')).toBe(true)
    expect((await m.getNewsStatus()).eventCount).toBe(0)
    expect((await m.getNewsStatus()).settings.source).toBe('none')
    t = NOW + 4 * 60_000
    expect(await code(m.testNewsSource(ff))).toBe('news:tooSoon')
    expect((await m.getNewsStatus()).nextRequestAt).toBe(NOW + 5 * 60_000)
    // Confirmé avant d'enregistrer les réglages : refusé (et le test est consommé).
    expect(await code(m.keepTestedNews())).toBe('news:previewOutdated')
    t = NOW + 5 * 60_000
    await m.testNewsSource(ff)
    await m.setNewsSettings(ff)
    const kept = await m.keepTestedNews()
    expect(kept.summary?.added).toBe(simulatedEvents(t).length)
    // Vaut récupération du jour : rien à l'ouverture suivante.
    t = NOW + 3 * 3_600_000
    expect((await m.refreshNews(false)).fetched).toBe(false)
  })
})
