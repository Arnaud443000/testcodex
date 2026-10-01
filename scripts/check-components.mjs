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

// ───────────────────────── Infobulle ─────────────────────────
{
  const page = await newPage()
  await go(page, '/')
  const info = page.locator('.cursor-help').first()
  await info.scrollIntoViewIfNeeded()
  await info.hover()
  check((await page.getByRole('tooltip').count()) === 0, 'infobulle : pas d’apparition immédiate au survol')
  await page.waitForTimeout(450)
  const tip = page.getByRole('tooltip')
  check((await tip.count()) === 1, 'infobulle : apparaît après le délai (~250 ms) au survol')
  check(await tip.evaluate((el) => el.parentElement === document.body), 'infobulle : rendue dans un portail')
  check((await tip.evaluate((el) => getComputedStyle(el).fontFamily)).includes('Inter'), 'infobulle : police Inter')
  const id = await tip.getAttribute('id')
  check((await info.getAttribute('aria-describedby'))?.includes(id), 'infobulle : aria-describedby relie l’élément à l’infobulle')
  const r = await tip.boundingBox()
  check(r && r.x >= 0 && r.y >= 0 && r.x + r.width <= 1440 && r.y + r.height <= 900, 'infobulle : entièrement dans la fenêtre')
  await shot(page, 'lot29-apres-infobulle-1440x900')
  await page.keyboard.press('Escape')
  check((await page.getByRole('tooltip').count()) === 0, 'infobulle : Échap la ferme')
  await page.mouse.move(700, 450)

  // Focus clavier : Tab jusqu'à l'icône « i » (focusable)
  await page.mouse.move(5, 5)
  await page.evaluate(() => document.activeElement && document.activeElement.blur())
  let reached = false
  for (let i = 0; i < 80 && !reached; i++) {
    await page.keyboard.press('Tab')
    reached = await page.evaluate(() => document.activeElement?.classList.contains('cursor-help'))
  }
  check(reached, 'infobulle : l’icône « i » est atteinte au clavier (Tab)')
  await page.waitForTimeout(450)
  check((await page.getByRole('tooltip').count()) === 1, 'infobulle : apparaît aussi au focus clavier')
  await page.keyboard.press('Escape')
  await page.evaluate(() => document.activeElement && document.activeElement.blur())

  // Bord de fenêtre : la cloche, tout en haut à droite
  await page.getByRole('link', { name: 'Notifications' }).hover().catch(() => {})
  await page.waitForTimeout(450)
  const bell = page.getByRole('tooltip')
  if (await bell.count()) {
    const b = await bell.boundingBox()
    check(b.x >= 0 && b.x + b.width <= 1440 && b.y >= 0, 'infobulle : près du bord droit, elle se replace dans la fenêtre')
  }
  // Plus aucun title= natif à l'écran
  for (const route of ['/', '/trades', '/calendar', '/analytics', '/behavior', '/discipline', '/settings', '/sizing', '/journal']) {
    await go(page, route)
    const n = await page.locator('[title]:not(svg *)').count()
    check(n === 0, `infobulle : aucun attribut title natif sur ${route}${n ? ` (${n})` : ''}`)
  }
  // Calendrier : survol d'un jour
  await go(page, '/calendar')
  const day = page.locator('[role=gridcell][aria-pressed]').first()
  if (await day.count()) {
    await day.hover()
    await page.waitForTimeout(450)
    check((await page.getByRole('tooltip').count()) === 1, 'infobulle : un jour du calendrier affiche son résultat au survol')
    await shot(page, 'lot29-apres-infobulle-calendrier-1440x900')
  }
  await page.context().close()
}

// ───────────────────────── Case à cocher ─────────────────────────
{
  const page = await newPage()
  await go(page, '/replay')
  check((await page.locator('input[type=checkbox]:not(label.group input)').count()) === 0, 'case : aucune case native hors du composant')
  const box = page.getByRole('checkbox', { name: /capture/i }).first()
  check((await box.count()) === 1, 'case : un vrai <input type=checkbox> nommé par son libellé')
  check(!(await box.isChecked()), 'case : décochée au départ')
  const label = page.locator('label.group', { has: box })
  const lb = await label.boundingBox()
  check(lb.height >= 24, `case : la ligne libellée fait ${Math.round(lb.height)} px de haut (≥ 24)`)
  await label.getByText(/capture/i).click()
  check(await box.isChecked(), 'case : un clic sur le libellé la coche')
  check((await label.locator('svg').count()) === 1, 'case : la coche est dessinée (forme), pas seulement la couleur')
  await shot(page, 'lot29-apres-case-cochee-1440x900')
  await box.focus()
  await page.keyboard.press('Space')
  check(!(await box.isChecked()), 'case : Espace la décoche au clavier')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  const ring = await label.locator('span[aria-hidden]').first().evaluate((el) => getComputedStyle(el).outlineStyle)
  check(ring === 'solid', 'case : l’anneau de focus est sur le contour de la case')
  // Désactivée : carte de trade (options grisées) si disponible
  await go(page, '/trades')
  await page.context().close()
}

// ───────────────────────── Sélecteur d'actif ─────────────────────────
{
  const page = await newPage()
  for (const route of ['/sizing', '/trades/new']) {
    await go(page, route)
    const asset = page.locator('#s-asset, #f-asset').first()
    check((await asset.count()) === 1, `actif : le champ existe sur ${route}`)
    await asset.click()
    const list = page.getByRole('listbox', { name: /actif/i })
    check((await list.count()) === 1, `actif : la liste s’ouvre (${route})`)
    check(await list.evaluate((el) => el.closest('.popover-panel')?.parentElement === document.body), `actif : panneau dans un portail (${route})`)
    check((await list.evaluate((el) => getComputedStyle(el).scrollbarWidth)) === 'thin', `actif : barre de défilement fine aux couleurs de l’app (${route})`)
    await asset.fill('xau')
    await page.getByRole('option').first().click()
    const v1 = await asset.inputValue()
    check(/^\S+ — .+/.test(v1), `actif : le champ affiche « SYMBOLE — nom » (${route}) : ${v1}`)
    const overlay = await asset.evaluate((el) => el.parentElement.querySelectorAll('span.absolute.inset-y-0').length)
    check(overlay === 0, `actif : plus de texte superposé au champ (${route})`)
    const fits = await asset.evaluate((el) => getComputedStyle(el).textOverflow === 'ellipsis' && getComputedStyle(el).whiteSpace === 'nowrap')
    check(fits, `actif : texte sur une ligne coupée par « … » (${route})`)
    await shot(page, `lot29-apres-selecteur-actif-ferme-${route.slice(1).replace(/\//g, '-')}-1440x900`)
    await asset.click()
    await page.keyboard.press('Escape')
    check((await asset.inputValue()) === v1, `actif : après ouverture puis fermeture, la valeur est intacte (${route})`)
    await asset.click()
    await shot(page, `lot29-apres-selecteur-actif-ouvert-${route.slice(1).replace(/\//g, '-')}-1440x900`)
    await page.keyboard.press('Escape')
  }
  await page.context().close()
}

await browser.close()
if (server) server.kill()
console.log(failures.length ? `\n${failures.length} échec(s)` : '\nTout est bon.')
process.exit(failures.length ? 1 : 0)
