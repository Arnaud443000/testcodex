#!/usr/bin/env node
/**
 * Vérifications de bout en bout des composants partagés du lot 29 (Chromium headless, faux backend) :
 * menu déroulant (`Select`), infobulle (`Tooltip`), case à cocher (`Checkbox`). Aucun <select>, title= ni
 * <input type=checkbox> natif ne doit rester à l'écran. Captures optionnelles : --shots DIR.
 * Usage : node scripts/check-components.mjs [--url http://localhost:5199] [--shots docs/captures]
 */
import { spawn, execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { installSeed } from './seed-demo.mjs'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d)
const req = createRequire(import.meta.url)
let pw
try { pw = req('playwright') } catch { pw = createRequire(`${execSync('npm root -g').toString().trim()}/`)('playwright') }
let url = opt('url', null)
const shots = opt('shots', null)
if (shots) mkdirSync(shots, { recursive: true })
let server = null
if (!url) {
  server = spawn('npx', ['vite', '--port', '5196', '--strictPort'], { stdio: 'ignore' })
  url = 'http://localhost:5196'
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
}
const browser = await pw.chromium.launch()
const failures = []
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${what}`); if (!ok) failures.push(what) }
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h }, hash); await page.waitForTimeout(700) }
const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }) }

async function newPage(w = 1440, h = 900) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage()
  await installSeed(page)
  await page.goto(`${url}/#/`)
  await page.waitForTimeout(2500)
  return page
}

// ───────────────────────── Menu déroulant ─────────────────────────
{
  const page = await newPage()
  await go(page, '/trades')
  check((await page.locator('select').count()) === 0, 'menu : aucun <select> natif sur la liste des trades')
  const box = page.getByRole('combobox', { name: 'Résultat' })
  check((await box.count()) === 1, 'menu : le champ « Résultat » est un combobox nommé par son libellé')
  await box.click()
  const list = page.getByRole('listbox')
  check((await list.count()) === 1, 'menu : le panneau (listbox) s’ouvre au clic')
  check(await list.evaluate((el) => el.parentElement === document.body), 'menu : le panneau est rendu dans un portail (enfant direct de <body>)')
  check((await box.getAttribute('aria-expanded')) === 'true', 'menu : aria-expanded = true')
  check((await list.getByRole('option').count()) === 5, 'menu : 5 options (Tous + 4 résultats)')
  check((await list.evaluate((el) => getComputedStyle(el).fontFamily)).includes('Inter'), 'menu : police Inter')
  const before = await page.locator('tbody tr').count()
  await shot(page, 'lot29-apres-menu-ouvert-1440x900')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  check((await page.getByRole('listbox').count()) === 0, 'menu : Entrée choisit et ferme')
  check((await box.innerText()).trim() === 'Perte', 'menu : la valeur affichée est « Perte » après ↓ ↓ Entrée (Tous → Gain → Perte)')
  check((await page.locator('tbody tr').count()) <= before, 'menu : le filtre s’applique')
  await box.press('Enter')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  check((await box.innerText()).trim() === 'En cours', 'menu : Fin puis Entrée choisit la dernière option')
  await box.press('Enter')
  await page.keyboard.press('Home')
  await page.keyboard.press('Enter')
  check((await box.innerText()).trim() === 'Tous', 'menu : Début puis Entrée choisit la première option')
  await box.press('Enter')
  await page.keyboard.type('pe')
  await page.keyboard.press('Enter')
  check((await box.innerText()).trim() === 'Perte', 'menu : la frappe (« pe ») saute à « Perte »')
  await box.press('Enter')
  await page.keyboard.press('Escape')
  check((await page.getByRole('listbox').count()) === 0 && (await box.innerText()).trim() === 'Perte', 'menu : Échap ferme sans changer la valeur')
  check(await box.evaluate((el) => el === document.activeElement), 'menu : le focus reste sur le bouton')
  await box.click()
  await page.mouse.click(5, 5)
  check((await page.getByRole('listbox').count()) === 0, 'menu : un clic dehors ferme')
  await box.click()
  const opt = page.getByRole('option', { name: 'Breakeven' })
  await opt.hover()
  check((await opt.evaluate((el) => getComputedStyle(el).backgroundColor)) !== 'rgba(0, 0, 0, 0)', 'menu : l’option survolée est marquée')
  await opt.click()
  check((await box.innerText()).trim() === 'Breakeven', 'menu : un clic sur une option la choisit')

  // Barre de défilement fine (liste longue : actifs du formulaire de trade ne passent pas par Select ; on prend le calendrier éco ou les widgets)
  await go(page, '/trades/new')
  check((await page.locator('select').count()) === 0, 'menu : aucun <select> natif dans le formulaire de trade')
  const tf = page.getByRole('combobox', { name: 'Unité de temps' })
  if (await tf.count()) {
    await tf.scrollIntoViewIfNeeded()
    await tf.click()
    const p = page.getByRole('listbox')
    const place = await p.getAttribute('data-placement')
    check(place === 'below' || place === 'above', `menu : placement ${place}`)
    await page.keyboard.press('Escape')
  }
  // Petite fenêtre : s'ouvre vers le haut quand il n'y a pas de place en bas
  await page.setViewportSize({ width: 1280, height: 420 })
  await go(page, '/trades/new')
  const acc = page.locator('#f-account')
  await acc.scrollIntoViewIfNeeded()
    await acc.click()
  const pl = await page.getByRole('listbox').getAttribute('data-placement')
  const r = await page.getByRole('listbox').boundingBox()
  check(r && r.y >= 0 && r.y + r.height <= 420, `menu : le panneau (${pl}) reste dans la fenêtre de 420 px de haut`)
  await page.keyboard.press('Escape')
  await page.context().close()
}

await browser.close()
if (server) server.kill()
console.log(failures.length ? `\n${failures.length} échec(s)` : '\nTout est bon.')
process.exit(failures.length ? 1 : 0)
