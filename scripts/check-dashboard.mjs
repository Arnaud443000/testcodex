#!/usr/bin/env node
/**
 * Lot 29 : aucune carte du tableau de bord n'a de barre de défilement à sa taille par défaut (les trois dashboards livrés
 * et un dashboard contenant tous les widgets à leur taille par défaut), à 1280×720, 1440×900 et 1920×1080.
 * Avec --min : mesure aussi les tailles minimales du catalogue (informatif : les minimums sont dans dashboards.rs).
 * Usage : node scripts/check-dashboard.mjs [--url http://localhost:5199] [--min]
 */
import { spawn, execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { installSeed } from './seed-demo.mjs'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d)
const req = createRequire(import.meta.url)
let pw
try { pw = req('playwright') } catch { pw = createRequire(`${execSync('npm root -g').toString().trim()}/`)('playwright') }
let url = opt('url', null)
let server = null
if (!url) {
  server = spawn('npx', ['vite', '--port', '5194', '--strictPort'], { stdio: 'ignore' })
  url = 'http://localhost:5194'
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
}
const withMin = args.includes('--min')
const browser = await pw.chromium.launch()
const failures = []
const info = []
for (const [w, h] of [[1280, 720], [1440, 900], [1920, 1080]]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage()
  await installSeed(page)
  await page.goto(`${url}/#/`)
  await page.waitForTimeout(2500)
  // Lot 36 : le widget « Bilan hebdomadaire » est mesuré avec trois intentions en cours (le cas le plus chargé).
  await page.evaluate(async () => {
    const { mockReview } = await import('/src/lib/mockBackend.ts')
    const { currentPeriodKey, shiftPeriod } = await import('/src/lib/processPeriods.ts')
    const key = shiftPeriod('week', currentPeriodKey('week', Date.now(), -new Date().getTimezoneOffset()), -1)
    const answers = { wentWell: 'Mes stops.', doDifferently: '', nextPriority: '' }
    mockReview.seed({ periodKey: key, createdAt: Date.now(), updatedAt: Date.now(), completedAt: null, answers, intentions: [
      { text: 'Un stop sur chaque trade, sans exception', outcome: 'kept' }, { text: 'Pas de trade après deux pertes de suite', outcome: 'partly' }, { text: 'Écrire mon journal chaque soir', outcome: null },
    ] })
  })
  const keys = await page.evaluate(async (withMin) => {
    const { api } = await import('/src/lib/api.ts')
    const cat = await api.listWidgetCatalog()
    const all = (await api.listDashboardLayouts()).map((s) => s.key)
    const build = (name, min) => {
      let x = 0, y = 0, rowH = 0
      const widgets = cat.map((d, i) => {
        const ww = min ? d.minW : d.defaultW
        const hh = min ? d.minH : d.defaultH
        if (x + ww > 30) { x = 0; y += rowH; rowH = 0 }
        const it = { uid: `w${i}`, kind: d.kind, x, y, w: ww, h: hh, period: null, accountId: null, mode: null }
        x += ww; rowH = Math.max(rowH, hh)
        return it
      })
      return api.saveDashboardLayout(null, name, widgets)
    }
    const defaults = await build('Mesure défauts', false)
    const out = [...all.map((k) => [k, false]), [defaults.key, false]]
    if (withMin) out.push([(await build('Mesure minimums', true)).key, true])
    return out
  }, withMin)
  for (const [key, minimum] of keys) {
    await page.evaluate(() => { location.hash = '/trades' }); await page.waitForTimeout(300)
    await page.evaluate(() => { location.hash = '/' }); await page.waitForTimeout(1200)
    const name = await page.evaluate(async (k) => (await (await import('/src/lib/api.ts')).api.getDashboardLayout(k)).name, key)
    await page.getByRole('combobox', { name: /dashboard/i }).first().click()
    await page.getByRole('option', { name: new RegExp('^' + name) }).click()
    await page.waitForTimeout(2500)
    const res = await page.evaluate(() => [...document.querySelectorAll('main .glass-card')]
      .filter((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)
      .map((el) => `${(el.querySelector('h3,h2')?.textContent ?? '?').trim().slice(0, 28)} (+${el.scrollHeight - el.clientHeight} px)`))
    const label = `${w}×${h} ${name}${minimum ? ' (tailles minimales)' : ''}`
    if (minimum) info.push(`${label} : ${res.length ? res.join(' ; ') : 'aucun défilement'}`)
    else {
      console.log(`${res.length ? 'ÉCHEC' : 'ok  '} ${label} : ${res.length ? res.join(' ; ') : 'aucun défilement'}`)
      if (res.length) failures.push(label)
    }
  }
  await page.context().close()
}
if (info.length) console.log(`\nInformatif — tailles minimales du catalogue (dashboards.rs) :\n${info.join('\n')}`)
await browser.close()
if (server) server.kill()
console.log(failures.length ? `\n${failures.length} échec(s)` : '\nTout est bon.')
process.exit(failures.length ? 1 : 0)
