#!/usr/bin/env node
/**
 * Vérifie de bout en bout (Chromium headless) le réglage « Réduire les effets » du lot 26 :
 * défaut = suit le système ; choix « Réduits » / « Complets » ; mémorisé après rechargement ;
 * flous et ombres réellement coupés quand c'est réduit. Usage : node scripts/check-effects.mjs [--url http://localhost:5199] [--shots DIR]
 */
import { spawn, execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d)
const req = createRequire(import.meta.url)
let pw
try { pw = req('playwright') } catch { pw = createRequire(`${execSync('npm root -g').toString().trim()}/`)('playwright') }

let url = opt('url', null)
let server = null
if (!url) {
  server = spawn('npx', ['vite', '--port', '5198', '--strictPort'], { stdio: 'ignore' })
  url = 'http://localhost:5198'
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
}
const shots = opt('shots', null)
if (shots) mkdirSync(shots, { recursive: true })
const browser = await pw.chromium.launch()
const failures = []
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${what}`); if (!ok) failures.push(what) }
const mode = (page) => page.evaluate(() => document.documentElement.dataset.effects)
const css = (page, sel, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [sel, prop])

// 1. Système sans préférence : effets complets
let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' })
let page = await ctx.newPage()
await page.goto(`${url}/#/`)
await page.waitForTimeout(600)
check((await mode(page)) === 'full', 'par défaut, sans préférence système : effets complets')
check((await css(page, '.glass-bar', 'backdropFilter')) !== 'none', 'effets complets : la barre latérale est floutée')

// 2. Choix « Réduits » dans Paramètres > Affichage
await page.evaluate(() => { location.hash = '/settings' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Réduits' }).click()
await page.waitForTimeout(200)
check((await mode(page)) === 'reduced', 'choix « Réduits » : <html data-effects="reduced">')
check((await css(page, '.glass-bar', 'backdropFilter')) === 'none', 'réduits : plus de flou sur la barre latérale')
check((await css(page, '.glass-card', 'boxShadow')) === 'none', 'réduits : plus d\'ombre sur les cartes')
check((await page.evaluate(() => localStorage.getItem('pulse.effects'))) === 'reduced', 'le choix est mémorisé localement')
if (shots) await page.screenshot({ path: `${shots}/lot26-effets-reduits-parametres.png` })
await page.evaluate(() => { location.hash = '/' })
await page.waitForTimeout(400)
if (shots) await page.screenshot({ path: `${shots}/lot26-effets-reduits-dashboard.png` })

// 3. Rechargement : le choix persiste
await page.reload()
await page.waitForTimeout(600)
check((await mode(page)) === 'reduced', 'après rechargement : toujours réduit')

// 3 bis. Effets réduits : menu déroulant et infobulle sans flou ni animation (lot 29)
await page.getByRole('combobox', { name: 'Compte' }).click()
const menuLook = await page.getByRole('listbox').evaluate((el) => ({ blur: getComputedStyle(el).backdropFilter, fond: getComputedStyle(el).backgroundColor }))
check(menuLook.blur === 'none', 'réduits : le menu déroulant n’est plus flouté')
check(menuLook.fond === 'rgb(23, 27, 51)', 'réduits : le menu déroulant a un fond plein')
await page.keyboard.press('Escape')
await page.getByRole('link', { name: 'Notifications' }).hover()
await page.waitForTimeout(450)
const tipLook = await page.getByRole('tooltip').evaluate((el) => ({ blur: getComputedStyle(el).backdropFilter, anim: getComputedStyle(el).animationName }))
check(tipLook.blur === 'none' && tipLook.anim === 'none', 'réduits : l’infobulle est sans flou et sans animation')
await ctx.close()

// 4. « Suivre le système » avec un système qui demande moins d'animations
ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
page = await ctx.newPage()
await page.goto(`${url}/#/`)
await page.waitForTimeout(600)
check((await mode(page)) === 'reduced', 'le système demande moins d\'animations : Pulse réduit les effets (réglage par défaut)')
await page.evaluate(() => { location.hash = '/settings' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Complets' }).click()
await page.waitForTimeout(200)
check((await mode(page)) === 'full', 'choix « Complets » : l\'emporte sur le système')
await ctx.close()

await browser.close()
if (server) server.kill()
console.log(failures.length ? `\n${failures.length} échec(s)` : '\nTout est bon.')
process.exit(failures.length ? 1 : 0)
