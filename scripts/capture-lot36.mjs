#!/usr/bin/env node
/**
 * Captures du lot 36 (docs/captures/lot36-<vue>-<taille>.png) : bilan hebdomadaire vide (et refus d'un bilan vide),
 * bannière du dimanche, brouillon enregistré, bilan terminé, intentions suivies avec leur série, historique, réglage du
 * rappel, widget. Rejoue les scénarios `review-*` de scripts/visual-audit.mjs sur le faux backend semé (la semaine
 * précédente a des trades clôturés ; la semaine en cours, non).
 * Usage : node scripts/capture-lot36.mjs [--url http://localhost:5196] [--out docs/captures]
 */
import { spawn, execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { installSeed } from './seed-demo.mjs'
import { SCENARIOS } from './visual-audit.mjs'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d)
const req = createRequire(import.meta.url)
let pw
try { pw = req('playwright') } catch { pw = createRequire(`${execSync('npm root -g').toString().trim()}/`)('playwright') }
let url = opt('url', null)
let server = null
if (!url) {
  server = spawn('npx', ['vite', '--port', '5196', '--strictPort'], { stdio: 'ignore' })
  url = 'http://localhost:5196'
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
}
const out = opt('out', 'docs/captures')
mkdirSync(out, { recursive: true })
const scenario = (name) => SCENARIOS.find(([n]) => n === name)[1]
const browser = await pw.chromium.launch()
for (const [w, h] of [[1440, 900], [1920, 1080]]) {
  const size = `${w}x${h}`
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, locale: 'fr-FR' })).newPage()
  await installSeed(page)
  await page.goto(`${url}/#/`)
  await page.waitForTimeout(3000)
  const shot = (name) => page.screenshot({ path: `${out}/lot36-${name}-${size}.png` })
  const top = () => page.evaluate(() => document.querySelector('main .overflow-y-auto')?.scrollTo(0, 0))
  // Vide : les faits de la semaine, rien d'enregistré. Puis le refus d'un bilan entièrement vide.
  await scenario('review-vide')(page)
  await page.evaluate(() => document.querySelector('[data-testid="review-facts"]')?.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(300)
  await shot('vide')
  await scenario('review-vide-refus')(page)
  await shot('vide-refus')
  // Bannière du dimanche (clôturés + journal de la semaine).
  await scenario('review-banniere')(page)
  await top()
  await shot('banniere')
  // Brouillon, puis terminé.
  await scenario('review-brouillon')(page)
  await page.getByTestId('review-form').evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(300)
  await shot('brouillon')
  await scenario('review-fait')(page)
  await shot('fait')
  await top()
  await shot('fait-haut')
  // Intentions de la semaine passée suivies, avec la série.
  await scenario('review-intentions-suivies')(page)
  await shot('intentions-suivies')
  // Historique repliable ouvert.
  await scenario('review-historique')(page)
  await shot('historique')
  await scenario('review-parametres')(page)
  await shot('parametres')
  await scenario('review-widget')(page)
  await shot('widget')
  await page.context().close()
}
await browser.close()
if (server) server.kill()
