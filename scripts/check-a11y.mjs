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
for (const route of ['/', '/trades', '/settings', `/trades/${tradeId}`, '/journal', '/calendar', '/prop', '/goals?type=process', '/review']) {
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

// Lot 33 : éditeur des règles prop firm (compte « Prop challenge » du jeu de démonstration, sans règles).
await page.evaluate(() => { location.hash = '/prop' })
await page.waitForTimeout(800)
const propOpener = page.getByRole('button', { name: 'Paramétrer les règles' })
await propOpener.focus()
await propOpener.click()
await page.waitForTimeout(600)
check((await page.locator('[role=dialog][aria-modal=true]').count()) === 1, 'prop firm : l’éditeur des règles est une boîte modale nommée')
check(await inside(), 'prop firm : à l\'ouverture, le focus est dans l’éditeur')
escaped = false
for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if (!(await inside())) escaped = true }
check(!escaped, 'prop firm : Tab ×40, le focus ne sort jamais de l’éditeur')
escaped = false
for (let i = 0; i < 40; i++) { await page.keyboard.press('Shift+Tab'); if (!(await inside())) escaped = true }
check(!escaped, 'prop firm : Maj+Tab ×40, le focus ne sort jamais de l’éditeur')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check((await page.locator('[role=dialog]').count()) === 0, 'prop firm : Échap ferme l’éditeur')
check((await page.evaluate(() => document.activeElement?.textContent?.trim())) === 'Paramétrer les règles', 'prop firm : le focus revient au bouton d’ouverture')
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


// Lot 36 : bilan hebdomadaire (aucune boîte de dialogue : une page, une bannière, une confirmation en ligne).
await page.evaluate((h) => { location.hash = h }, '/review')
await page.waitForTimeout(800)
check((await page.locator('h1').count()) === 1, 'bilan : un seul titre de page (h1)')
const unlabelled = await page.evaluate(() => [...document.querySelectorAll('[data-testid="review-page"] input, [data-testid="review-page"] textarea')].filter((el) => !(el.getAttribute('aria-label') || (el.id && document.querySelector(`label[for="${el.id}"]`)))).map((el) => el.outerHTML.slice(0, 80)))
check(unlabelled.length === 0, `bilan : chaque champ de saisie a une étiquette${unlabelled.length ? ' : ' + unlabelled[0] : ''}`)
check((await page.locator('[data-testid="review-page"] form form').count()) === 0 && (await page.locator('[data-testid="review-page"] form').count()) === 1, 'bilan : un seul <form>, aucun imbriqué')
check((await page.locator('[data-testid="review-form"] button:not([type])').count()) === 0, 'bilan : tous les boutons du formulaire ont un type explicite')
const submits = await page.locator('[data-testid="review-form"] button[type=submit]').count()
check(submits === 1, 'bilan : un seul bouton d’envoi (« Enregistrer le brouillon »)')
const stateBadge = await page.locator('[data-review-state]').first().evaluate((el) => ({ text: el.textContent.trim(), icon: !!el.querySelector('svg') }))
check(stateBadge.text.length > 0 && stateBadge.icon, 'bilan : l’état (à faire / brouillon / fait) a un texte et une icône')
// Un bilan vide n'est pas envoyable ; Entrée dans un champ d'intention enregistre le brouillon (c'est l'envoi voulu).
check(await page.getByRole('button', { name: 'Terminer le bilan' }).isDisabled(), 'bilan : « Terminer le bilan » est grisé tant que rien n’est écrit')
await page.getByLabel('Intention 1', { exact: true }).fill('Un stop sur chaque trade')
await page.getByLabel('Intention 1', { exact: true }).press('Enter')
await page.waitForTimeout(500)
check((await page.getByRole('status').filter({ hasText: 'Brouillon enregistré.' }).count()) === 1, 'bilan : Entrée dans le champ d’intention enregistre le brouillon, annoncé dans une zone de statut')
// Suivi des intentions de la semaine d'avant : groupes nommés, aria-pressed, texte + icône.
await page.evaluate(async () => {
  const { mockReview } = await import('/src/lib/mockBackend.ts')
  const { currentPeriodKey, shiftPeriod } = await import('/src/lib/processPeriods.ts')
  const key = shiftPeriod('week', currentPeriodKey('week', Date.now(), -new Date().getTimezoneOffset()), -1)
  mockReview.seed({ periodKey: key, createdAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(), answers: { wentWell: 'x', doDifferently: '', nextPriority: '' }, intentions: [{ text: 'Un stop partout', outcome: null }] })
})
await page.evaluate((h) => { location.hash = h }, '/review?week=0000-W01')
await page.evaluate((h) => { location.hash = h }, '/review')
await page.waitForTimeout(800)
const group = page.getByRole('group', { name: /Où en est l’intention/ })
check((await group.count()) === 1 && (await group.getByRole('button').count()) === 3, 'bilan : le suivi d’une intention est un groupe nommé de trois boutons')
await group.getByRole('button', { name: 'En partie' }).focus()
await page.keyboard.press('Enter')
await page.waitForTimeout(400)
check((await group.getByRole('button', { name: 'En partie' }).getAttribute('aria-pressed')) === 'true', 'bilan : le choix du suivi se fait au clavier (aria-pressed)')
const outcomes = await page.locator('[data-outcome]').evaluateAll((els) => els.map((e) => ({ text: e.textContent.trim(), icon: !!e.querySelector('svg') })))
check(outcomes.length > 0 && outcomes.every((o) => o.text && o.icon), 'bilan : chaque suivi d’intention a un texte et une icône (jamais la couleur seule)')
// Bannière du dimanche : dans le flux (jamais fixe), deux boutons nommés.
await page.evaluate(async () => {
  const { mockReview } = await import('/src/lib/mockBackend.ts')
  const d = new Date()
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) - 1 + 0)
  mockReview.setClock(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 18, 30).getTime())
  mockReview.reset()
  mockReview.setClock(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 18, 30).getTime())
})
await page.evaluate((h) => { location.hash = h }, '/journal')
await page.waitForTimeout(900)
const banner = page.getByTestId('weekly-review-banner')
if ((await banner.count()) === 1) {
  check((await banner.evaluate((el) => !['fixed', 'sticky'].includes(getComputedStyle(el).position) && !['fixed', 'sticky'].includes(getComputedStyle(el.firstElementChild).position))), 'bannière du bilan : dans le flux de la page (ni fixe ni collante)')
  check((await banner.getByRole('link', { name: 'Faire le bilan' }).count()) === 1 && (await banner.getByRole('button', { name: 'Plus tard' }).count()) === 1, 'bannière du bilan : « Faire le bilan » et « Plus tard »')
  await banner.getByRole('button', { name: 'Plus tard' }).click()
  await page.waitForTimeout(400)
  check((await page.getByTestId('weekly-review-banner').count()) === 0, 'bannière du bilan : « Plus tard » la fait disparaître')
} else {
  check(false, 'bannière du bilan : visible le dimanche à 18:30 (la semaine précédente a des trades clôturés)')
}
await page.evaluate(async () => (await import('/src/lib/mockBackend.ts')).mockReview.setClock(null))

await browser.close()
if (server) server.kill()
console.log(failures.length ? `\n${failures.length} échec(s)` : '\nTout est bon.')
process.exit(failures.length ? 1 : 0)
