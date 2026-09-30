/**
 * Sème un jeu de démonstration dans le faux backend du navigateur (serveur `npm run dev`), depuis Playwright.
 * Utilisé par scripts/visual-audit.mjs. Ne sert jamais dans l'application réelle.
 * Le module `api` est importé par le serveur Vite : c'est la même instance que celle de l'application.
 */
async function seedInPage() {
  {
    const { api } = await import('/src/lib/api.ts')
    const acc = await api.createAccount({ name: 'Compte principal', kind: 'personal', broker: 'Courtier', currency: 'USD', initialCapital: '10000' })
    await api.createAccount({ name: 'Prop challenge', kind: 'prop', broker: 'Prop', currency: 'USD', initialCapital: '50000' })
    const instruments = await api.listInstruments()
    const tags = await api.listTags()
    const byName = (n) => tags.find((t) => t.name === n)?.id
    const inst = (s) => instruments.find((i) => i.symbol === s)
    const rules = [await api.createRule('Pas de trade après 2 pertes'), await api.createRule('Risque max 1 %'), await api.createRule('Attendre la clôture de bougie')]
    const items = [await api.createChecklistItem('Tendance en H4 vérifiée'), await api.createChecklistItem('Stop placé')]
    const setup = await api.createTag('setup', 'Cassure NY')
    const setup2 = await api.createTag('setup', 'Retour à la moyenne')
    const specs = [
      ['EURUSD', 1.08, 0.002, 0.1],
      ['GBPUSD', 1.27, 0.003, 0.1],
      ['XAUUSD', 2350, 8, 0.1],
      ['BTCUSD', 65000, 900, 0.01],
    ]
    const DAY = 86_400_000
    const now = Date.now()
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const ids = []
    for (let i = 0; i < 46; i++) {
      const [sym, px, dist, size] = specs[i % specs.length]
      const ins = inst(sym)
      if (!ins) continue
      const day = now - (50 - i) * DAY * 1.05
      const d = new Date(day)
      d.setUTCHours(8 + (i % 9), (i * 7) % 60, 0, 0)
      const entryTime = d.getTime()
      const long = i % 3 !== 0
      const win = rnd() < 0.55
      const move = dist * (win ? 0.6 + rnd() * 1.6 : -(0.3 + rnd() * 0.9))
      const dec = px > 1000 ? 1 : 4
      const fx = (n) => n.toFixed(dec)
      const dir = long ? 1 : -1
      const entry = px
      const exit = px + dir * move
      const sl = px - dir * dist
      const tp = px + dir * dist * 2
      const tr = await api.createTrade({
        accountId: acc.id,
        instrumentId: ins.id,
        direction: long ? 'long' : 'short',
        size: String(size),
        entryPrice: fx(entry),
        exitPrice: fx(exit),
        entryTime,
        exitTime: entryTime + (20 + (i % 5) * 35) * 60_000,
        tzOffsetMin: 120,
        plannedSl: i % 11 === 0 ? null : fx(sl),
        plannedTp: fx(tp),
        fees: i % 4 === 0 ? '1.5' : '0.8',
        executionType: i % 2 ? 'discretionary' : 'system',
        conviction: 3 + (i % 7),
        planFollowed: ['yes', 'yes', 'partial', 'no'][i % 4],
        thesis: i % 3 ? 'Cassure d’un range après la session asiatique, volume en hausse.' : '',
        postMortem: i % 5 === 0 ? 'Sortie trop tôt, le prix a continué dans mon sens.' : '',
        tagIds: [i % 2 ? setup.id : setup2.id, byName(['Asie', 'Londres', 'New York'][i % 3]), byName('M15'), ...(win ? [] : [byName(i % 2 ? 'Sortie trop tôt' : 'Stop déplacé')])].filter(Boolean),
        emotions: [
          { moment: 'before', tagId: byName(win ? 'Calme' : 'Impatience') },
          { moment: 'after', tagId: byName(win ? 'Confiance' : 'Doute') },
        ].filter((e) => e.tagId),
        ruleChecks: rules.map((r, k) => ({ ruleId: r.id, respected: (i + k) % 4 !== 0 })),
        checklist: items.map((it, k) => ({ itemId: it.id, label: it.label, checked: (i + k) % 3 !== 0 })),
      })
      ids.push(tr.id)
    }
    // Un trade ouvert sans stop, puis dépôt, journal, objectifs, trades manqués.
    const eur = inst('EURUSD')
    await api.createTrade({
      accountId: acc.id, instrumentId: eur.id, direction: 'long', size: '0.2', entryPrice: '1.0850', entryTime: now - 3_600_000,
      tzOffsetMin: 120, fees: '0', thesis: '', postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [],
    })
    await api.createCashFlow({ accountId: acc.id, kind: 'deposit', amount: '2000', occurredAt: now - 30 * DAY, tzOffsetMin: 120, note: 'Dépôt' })
    for (let k = 0; k < 8; k++) {
      const day = new Date(now - k * 2 * DAY).toISOString().slice(0, 10)
      await api.saveJournalEntry({ day, mood: 2 + (k % 4), sleepQuality: 1 + (k % 5), fatigue: 1 + ((k * 2) % 5), lateHours: k % 3 === 0, wentWell: 'Patience sur les entrées.', toImprove: 'Respecter le stop.', notes: 'Journée calme.' })
    }
    const month = new Date().toISOString().slice(0, 7)
    for (const [metric, target] of [['net_pnl', '500'], ['win_rate', '55'], ['discipline_score', '75']]) {
      try { await api.setGoal({ month, metric, target }) } catch {}
    }
    for (let k = 0; k < 3; k++) {
      try {
        await api.createMissedTrade({ accountId: acc.id, instrumentId: eur.id, direction: 'long', occurredAt: now - (k + 2) * DAY, tzOffsetMin: 120, reason: 'Peur après une perte', notes: '', conviction: 6, tagIds: [] })
      } catch {}
    }
    // Lot 31 : analyses de séance (hier et aujourd'hui), idées à surveiller (à revoir, reportée deux fois, clôturées) et liens avec des trades.
    const { mockAnalysis } = await import('/src/lib/mockBackend.ts')
    const tz = -new Date().getTimezoneOffset()
    const questions = await api.getAnalysisQuestions(true)
    const q = (key) => questions.find((x) => x.key === key).id
    const at = (daysAgo, hour) => { const d = new Date(now - daysAgo * DAY); d.setHours(hour, 15, 0, 0); return d.getTime() }
    const answersOf = (levels, conviction) => [
      { questionId: q('trend'), value: { weekly: { trend: 'up', note: 'Au-dessus de la moyenne 50' }, daily: { trend: 'range', note: null }, h4: { trend: 'up', note: 'Creux plus hauts' } } },
      { questionId: q('levels'), value: levels },
      { questionId: q('scenarioMain'), value: 'Cassure de la résistance puis retest, entrée sur le retour.' },
      { questionId: q('invalidation'), value: 'Clôture H4 sous le dernier creux : je ne trade pas.' },
      { questionId: q('setups'), value: [setup.id] },
      { questionId: q('conviction'), value: conviction },
      { questionId: q('state'), value: { text: 'Reposé, pas pressé', tagIds: [byName('Calme')] } },
    ]
    const yesterday = await mockAnalysis.createAnalysis({ createdAt: at(1, 8), tzOffsetMin: tz, note: null, answers: answersOf('2 340 – 2 360 (résistance H4)', 7) })
    const today = await mockAnalysis.createAnalysis({ createdAt: at(0, 7), tzOffsetMin: tz, note: 'Séance du matin avant Londres.', answers: answersOf('1,0840 – 1,0870', 6) })
    const xau = inst('XAUUSD')
    const btc = inst('BTCUSD')
    const gbp = inst('GBPUSD')
    const mkIdea = (instrument, note, extra = {}) => ({ instrumentId: instrument.id, timeframes: ['weekly', 'daily'], note, levelLow: null, levelHigh: null, invalidation: null, ...extra })
    const stale = await mockAnalysis.createIdea(mkIdea(xau, 'Or : arrive sur un niveau intéressant, résistance possible en hebdomadaire. Si ça casse, accélération possible.', { levelLow: '2350.00', levelHigh: '2375.50', invalidation: 'Clôture journalière sous 2 320.' }), now - 9 * DAY)
    await mockAnalysis.ideaComplete(stale.id, 'Retest de la zone sans cassure franche.', tz, now - 8.5 * DAY)
    await mockAnalysis.createIdea(mkIdea(btc, 'BTC : range serré sous 66 000, attendre la sortie du range avant de penser à un long.', { timeframes: ['daily', 'h4'] }), now - 2 * DAY)
    const snoozed = await mockAnalysis.createIdea(mkIdea(gbp, 'GBPUSD : divergence en H4, à surveiller après la décision de la banque centrale.', { timeframes: ['h4'] }), now - 4 * DAY)
    await mockAnalysis.ideaSnooze(snoozed.id, 2, tz, now - 2 * DAY)
    await mockAnalysis.ideaSnooze(snoozed.id, 3, tz, now - 1 * DAY)
    for (const [i, outcome, reason] of [[0, 'worked', 'Cible atteinte en deux jours.'], [1, 'worked', ''], [2, 'invalidated', 'Clôture sous le niveau.'], [3, 'noFollowUp', 'Le marché n’est jamais arrivé sur la zone.'], [4, 'worked', 'Cassure puis retest.']]) {
      const done = await mockAnalysis.createIdea(mkIdea([xau, btc, gbp, eur, xau][i], `Idée terminée n°${i + 1}`), now - (20 + i) * DAY)
      await mockAnalysis.ideaClose(done.id, outcome, reason || null, tz, now - (12 + i) * DAY)
    }
    // Sept trades liés à l'idée sur l'or et à l'analyse d'hier, pour que le constat compare (5 trades par côté au moins).
    for (const tradeId of ids.slice(0, 7)) await mockAnalysis.setTradeLinks(tradeId, [stale.id], [yesterday.id])
    await mockAnalysis.setTradeLinks(ids[7], [], [today.id])
    return { firstTradeId: ids[0] ?? 1 }
  }
}

/**
 * Prépare la page pour qu'elle démarre AVEC les données : le module d'entrée attend le semis avant de monter
 * l'application (sinon les fournisseurs de comptes, déjà chargés, ne verraient rien). À appeler avant `goto`.
 */
export async function installSeed(page) {
  await page.addInitScript(`window.__seedReady = (${seedInPage.toString()})().then((r) => { window.__seedResult = r })`)
  await page.route(/\/src\/main\.tsx/, async (route) => {
    const res = await route.fetch()
    const body = (await res.text()).replace(/createRoot\(/, 'await window.__seedReady;\ncreateRoot(')
    await route.fulfill({ response: res, body })
  })
}

export const readSeed = (page) => page.evaluate(() => window.__seedResult)
