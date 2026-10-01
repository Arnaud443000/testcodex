#!/usr/bin/env node
/**
 * Captures du lot 32 (sauvegarde automatique) : docs/captures/lot32-<vue>-<taille>.png, 1440×900 et 1920×1080.
 * Vues : réglages désactivés, activés (avec la liste), en erreur, bannière d'invitation, bannière « dernière
 * sauvegarde ancienne ». Tout se passe dans le faux backend du navigateur (SIMULATION : aucun fichier écrit) ;
 * les états d'erreur et de sauvegarde ancienne sont posés par `mockBackupAuto.simulate`.
 * Vérifie aussi : aucune requête hors de localhost, aucun défilement horizontal de page, bannière dans le flux.
 * Usage : node scripts/capture-lot32.mjs [--url http://localhost:5199] [--out docs/captures]
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
const out = opt('out', 'docs/captures')
mkdirSync(out, { recursive: true })
const DAY = 86_400_000
const FOLDER = 'E:\\OneDrive\\Documents\\Pulse\\Sauvegardes automatiques'
const problems = []

const browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined })
for (const [w, h] of [[1440, 900], [1920, 1080]]) {
  const size = `${w}x${h}`
  const ctx = await browser.newContext({ viewport: { width: w, height: h } })
  const page = await ctx.newPage()
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && !u.protocol.startsWith('data')) problems.push(`requête externe : ${r.url()}`)
  })
  await installSeed(page)
  await page.goto(`${url}/#/`)
  await page.waitForTimeout(2500)
  const go = async (hash) => { await page.evaluate((x) => { location.hash = x }, hash); await page.waitForTimeout(1000) }
  const mockCall = (fn, arg) => page.evaluate(async ([f, a]) => {
    const m = await import('/src/lib/mockBackend.ts')
    return m.mockBackupAuto[f](a)
  }, [fn, arg])
  const checkPage = async (name) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (overflow > 0) problems.push(`${name} ${size} : défilement horizontal de ${overflow} px`)
    const fixed = await page.evaluate(() => [...document.querySelectorAll('[role=status],[role=alert]')].filter((e) => ['fixed', 'sticky'].includes(getComputedStyle(e).position)).length)
    if (fixed) problems.push(`${name} ${size} : bannière en position fixe`)
  }
  const shot = async (name) => { await checkPage(name); await page.screenshot({ path: `${out}/lot32-${name}-${size}.png` }) }
  const panel = async () => {
    await go('/') // démonte la page Paramètres : le panneau relit l'état
    await go('/settings#sauvegarde')
    await page.waitForTimeout(600)
    await page.locator('#sauvegarde').evaluate((e) => e.scrollIntoView({ block: 'start' }))
    await page.waitForTimeout(300)
  }

  // 1. Bannière d'invitation (des trades, sauvegarde automatique jamais activée).
  await go('/')
  if (!(await page.getByText('Protégez votre historique').isVisible())) problems.push(`invitation absente ${size}`)
  await shot('banniere-invitation')

  // 2. Réglages désactivés.
  await panel()
  await shot('desactivee')

  // 3. Activée, avec quelques sauvegardes présentes.
  const tz = await page.evaluate(() => -new Date().getTimezoneOffset())
  await page.evaluate(async ([folder, tz]) => {
    const { api } = await import('/src/lib/api.ts')
    await api.setAutoBackupSettings({ enabled: true, folder, frequency: 'daily', keep: 10 }, tz)
  }, [FOLDER, tz])
  const now = Date.now()
  await mockCall('simulate', { seedBackups: { at: [now - 3 * DAY, now - 2 * DAY, now - DAY], tz } })
  await panel()
  await page.getByRole('button', { name: 'Sauvegarder maintenant' }).click()
  await page.waitForTimeout(800)
  if (!(await page.getByText('Sauvegarde créée').isVisible())) problems.push(`« Sauvegarde créée » absent ${size}`)
  await page.locator('#sauvegarde').evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await shot('activee')

  // 4. Erreur (fichier bloqué par un antivirus / OneDrive).
  await mockCall('simulate', { failWith: 'fileInUse' })
  await page.waitForTimeout(61_000 - (Date.now() % 60_000)) // autre minute : sinon « même nom »
  await page.getByRole('button', { name: 'Sauvegarder maintenant' }).click()
  await page.waitForTimeout(800)
  await page.locator('#sauvegarde').evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await shot('erreur')

  // 5. Dernière sauvegarde ancienne (5 jours) avec un échec persistant : bannière dans la coque.
  await mockCall('simulate', { lastSuccessAt: Date.now() - 5 * DAY - 3_600_000, lastAttemptAt: Date.now() - 20 * 60_000, lastError: 'folderNotFound' })
  await go('/')
  if (!(await page.getByText(/dernière sauvegarde réussie date de 5 jours/).isVisible())) problems.push(`bannière « ancienne » absente ${size}`)
  await shot('banniere-ancienne')
  await ctx.close()
}
await browser.close()
if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log('lot 32 : captures écrites, aucun défaut détecté')
