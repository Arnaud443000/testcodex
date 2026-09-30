#!/usr/bin/env node
/**
 * Captures « avant » / « après » du lot 29 (docs/captures/lot29-<avant|apres>-<vue>-<taille>.png).
 * Les mêmes gestes servent aux deux versions de l'interface (rôles ARIA communs) : lancer le script une fois sur un
 * serveur de l'ancienne version (--prefix avant) et une fois sur la nouvelle (--prefix apres).
 * Limite : la liste déroulante d'un <select> natif est dessinée par le système et n'apparaît pas dans une capture
 * Chromium headless ; les infobulles natives (title=) non plus. Ces deux vues n'existent donc qu'en « après ».
 * Usage : node scripts/capture-lot29.mjs --url http://localhost:5190 --prefix avant [--out docs/captures]
 */
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { installSeed } from './seed-demo.mjs'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d)
const req = createRequire(import.meta.url)
let pw
try { pw = req('playwright') } catch { pw = createRequire(`${execSync('npm root -g').toString().trim()}/`)('playwright') }
const url = opt('url', 'http://localhost:5199')
const prefix = opt('prefix', 'apres')
const out = opt('out', 'docs/captures')
mkdirSync(out, { recursive: true })
const browser = await pw.chromium.launch()
for (const [w, h] of [[1440, 900], [1920, 1080]]) {
  const size = `${w}x${h}`
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage()
  await installSeed(page)
  await page.goto(`${url}/#/`)
  await page.waitForTimeout(3000)
  const go = async (hash) => { await page.evaluate((x) => { location.hash = x }, hash); await page.waitForTimeout(900) }
  const shot = (name) => page.screenshot({ path: `${out}/lot29-${prefix}-${name}-${size}.png` })

  await shot('dashboard')
  if (prefix === 'apres') {
    await page.locator('.cursor-help').first().hover()
    await page.waitForTimeout(500)
    await shot('infobulle')
    await page.mouse.move(5, 5)
  }
  await go('/sizing')
  const asset = page.locator('#s-asset')
  await asset.click()
  await asset.fill('xau')
  await page.getByRole('listbox', { name: /actif/i }).getByRole('option').first().click()
  await page.mouse.click(700, 700)
  await page.waitForTimeout(300)
  await shot('calculateur-actif-ferme')
  await asset.click()
  await page.waitForTimeout(300)
  await shot('calculateur-actif-ouvert')
  await page.keyboard.press('Escape')
  await go('/trades')
  await shot('trades-filtres')
  if (prefix === 'apres') {
    await page.getByRole('combobox', { name: 'Résultat' }).click()
    await page.waitForTimeout(300)
    await shot('menu-ouvert')
    await page.keyboard.press('Escape')
  }
  await go('/replay')
  await page.getByText('Avec capture').click()
  await page.getByText('Avec thèse ou post-mortem').click()
  await page.mouse.move(5, 5)
  await shot('cases')
  await page.context().close()
}
await browser.close()
