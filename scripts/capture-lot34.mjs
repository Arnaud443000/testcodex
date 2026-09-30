#!/usr/bin/env node
/**
 * Captures du lot 34 (docs/captures/lot34-<vue>-<taille>.png) : Objectifs > Comportement vide, création (avec une
 * saisie refusée), rempli avec chaque statut, semaine précédente (séries), liste des trades en cause, widget.
 * Rejoue les scénarios `objectifs-comportement-*` de scripts/visual-audit.mjs sur le faux backend semé.
 * Usage : node scripts/capture-lot34.mjs [--url http://localhost:5199] [--out docs/captures]
 */
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { installSeed } from './seed-demo.mjs'
import { SCENARIOS } from './visual-audit.mjs'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d)
const req = createRequire(import.meta.url)
let pw
try { pw = req('playwright') } catch { pw = createRequire(`${execSync('npm root -g').toString().trim()}/`)('playwright') }
const url = opt('url', 'http://localhost:5199')
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
  const shot = (name) => page.screenshot({ path: `${out}/lot34-${name}-${size}.png` })
  for (const [name, file] of [
    ['objectifs-comportement-vide', 'vide'],
    ['objectifs-comportement-creation', 'creation-refus'],
    ['objectifs-comportement-rempli', 'rempli'],
  ]) {
    await scenario(name)(page)
    await shot(file)
  }
  // Bas de la page : les dernières cartes et la note « clôturé dans la période ».
  await page.evaluate(() => document.querySelector('main .overflow-y-auto')?.scrollBy(0, 2000))
  await page.waitForTimeout(300)
  await shot('rempli-bas')
  await page.evaluate(() => document.querySelector('main .overflow-y-auto')?.scrollTo(0, 0))
  // Infobulle d'un statut, puis la boîte de modification.
  await page.locator('[data-status="exceeded"]').first().hover().catch(() => {})
  await page.waitForTimeout(500)
  await shot('statut-infobulle')
  await page.mouse.move(5, 5)
  await page.getByRole('button', { name: /^Modifier l’objectif/ }).first().click().catch(() => {})
  await page.waitForTimeout(400)
  await shot('modification')
  await page.keyboard.press('Escape')
  // « Voir les trades » : la liste filtrée sur les trades en cause.
  await page.getByTestId('process-goals').getByRole('link', { name: /Voir (le trade|les)/ }).first().click().catch(() => {})
  await page.waitForTimeout(800)
  await shot('trades-en-cause')
  await page.evaluate(() => { location.hash = '/goals?type=process&kind=week' })
  await page.waitForTimeout(800)
  await scenario('objectifs-comportement-precedente')(page)
  await shot('semaine-precedente')
  await page.evaluate(() => { location.hash = '/goals?type=process&kind=month' })
  await page.waitForTimeout(800)
  await shot('mois')
  await scenario('objectifs-comportement-widget')(page)
  await shot('widget')
  await page.context().close()
}
await browser.close()
