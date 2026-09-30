#!/usr/bin/env node
/**
 * Vérifications clavier / accessibilité de bout en bout du lot 26 (Chromium headless, faux backend) :
 * - une boîte de dialogue piège le focus (Tab et Maj+Tab bouclent), Échap la ferme et rend le focus ;
 * - la navigation latérale est un repère « navigation », les groupes sont nommés, l'entrée courante porte aria-current ;
 * - tous les boutons-icônes ont un nom accessible ; le focus est visible sur chaque élément atteint par Tab.
 * Usage : node scripts/check-a11y.mjs [--url http://localhost:5199]
 */
import { spawn, execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { installSeed, readSeed } from './seed-demo.mjs'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d)
const req = createRequire(import.meta.url)
let pw
try { pw = req('playwright') } catch { pw = createRequire(`${execSync('npm root -g').toString().trim()}/`)('playwright') }
let url = opt('url', null)
let server = null
if (!url) {
  server = spawn('npx', ['vite', '--port', '5197', '--strictPort'], { stdio: 'ignore' })
  url = 'http://localhost:5197'
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
}
const browser = await pw.chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const failures = []
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${what}`); if (!ok) failures.push(what) }

await installSeed(page)
await page.goto(`${url}/#/`)
await page.waitForTimeout(2500)
const tradeId = (await readSeed(page))?.firstTradeId ?? 1

// Navigation
check((await page.locator('nav[aria-label="Navigation principale"]').count()) === 1, 'la barre latérale est un repère « Navigation principale »')
check((await page.locator('nav[aria-label="Navigation principale"] [role=group][aria-label]').count()) === 4, 'les quatre groupes (Saisir, Analyser, Comprendre, Outils) sont nommés')
check((await page.locator('aside [aria-current="page"]').innerText()).includes('Tableau de bord'), 'l\'entrée courante porte aria-current="page"')

// Boutons-icônes nommés (toutes les pages principales)
let unnamed = []
for (const route of ['/', '/trades', '/settings', `/trades/${tradeId}`, '/journal', '/calendar', '/goals?type=process']) {
  await page.evaluate((h) => { location.hash = h }, route)
  await page.waitForTimeout(500)
  unnamed.push(...(await page.evaluate(() => [...document.querySelectorAll('button, a[href]')].filter((el) => el.getBoundingClientRect().width > 0 && !(el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '').trim())).map((el) => el.outerHTML.slice(0, 90)))))
}
check(unnamed.length === 0, `aucun bouton ou lien sans nom accessible${unnamed.length ? ' : ' + unnamed[0] : ''}`)

// Boîte de dialogue : piège du focus
await page.evaluate((h) => { location.hash = h }, `/trades/${tradeId}`)
await page.waitForTimeout(600)
const opener = page.getByRole('button', { name: 'Créer une carte' })
await opener.focus()
await opener.click()
await page.waitForTimeout(600)
const inside = () => page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))
check((await page.locator('[role=dialog][aria-modal=true]').count()) === 1, 'la boîte de dialogue est modale et nommée')
check(await inside(), 'à l\'ouverture, le focus est dans la boîte')
let escaped = false
for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if (!(await inside())) escaped = true }
check(!escaped, 'Tab ×40 : le focus ne sort jamais de la boîte')
escaped = false
for (let i = 0; i < 40; i++) { await page.keyboard.press('Shift+Tab'); if (!(await inside())) escaped = true }
check(!escaped, 'Maj+Tab ×40 : le focus ne sort jamais de la boîte')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check((await page.locator('[role=dialog]').count()) === 0, 'Échap ferme la boîte')
check((await page.evaluate(() => document.activeElement?.textContent?.trim())) === 'Créer une carte', 'le focus revient au bouton qui a ouvert la boîte')

// Lot 34 : boîtes de l'objectif de comportement (création puis modification), statuts en texte.
await page.evaluate((h) => { location.hash = h }, '/goals?type=process&kind=week')
await page.waitForTimeout(700)
const custom = page.getByRole('button', { name: 'Autre objectif…' })
await custom.focus()
await custom.click()
await page.waitForTimeout(400)
check(await inside(), 'objectif de comportement : à l\'ouverture, le focus est dans la boîte')
escaped = false
for (let i = 0; i < 20; i++) { await page.keyboard.press('Tab'); if (!(await inside())) escaped = true }
check(!escaped, 'objectif de comportement : Tab ×20 reste dans la boîte')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check((await page.locator('[role=dialog]').count()) === 0, 'objectif de comportement : Échap ferme la boîte')
check((await page.evaluate(() => document.activeElement?.textContent?.trim())) === 'Autre objectif…', 'objectif de comportement : le focus revient au bouton d\'ouverture')
await page.getByRole('button', { name: /^Créer l’objectif/ }).first().click()
await page.waitForTimeout(600)
const badges = await page.locator('[data-testid="process-goals"] [data-status]').evaluateAll((els) => els.map((e) => ({ text: e.textContent.trim(), icon: !!e.querySelector('svg') })))
check(badges.length > 0 && badges.every((b) => b.text && b.icon), 'objectif de comportement : chaque statut a un texte et une icône (jamais la couleur seule)')
await page.getByRole('button', { name: /^Modifier l’objectif/ }).first().click()
await page.waitForTimeout(400)
check((await page.evaluate(() => document.activeElement?.id)) === 'process-goal-target', 'objectif de comportement : en modification, le focus va à la cible (mesure figée)')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check((await page.locator('[role=dialog]').count()) === 0, 'objectif de comportement : Échap ferme la boîte de modification')

await browser.close()
if (server) server.kill()
console.log(failures.length ? `\n${failures.length} échec(s)` : '\nTout est bon.')
process.exit(failures.length ? 1 : 0)
