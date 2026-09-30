#!/usr/bin/env node
/**
 * Audit clavier de la pause volontaire (lot 35) : le formulaire de pause s'ouvre et se ferme au clavier (Entrée, Tab, Échap)
 * sans piéger le focus (bannière d'alerte et barre du haut), et Entrée dans le formulaire de trade démarre la pause
 * au lieu d'enregistrer le trade. Usage : node scripts/check-pause.mjs (serveur Vite lancé par le script ; playwright requis).
 */
import { createRequire } from 'node:module'
import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { installSeed } from './seed-demo.mjs'
function loadPlaywright() {
  try {
    return createRequire(import.meta.url)('playwright')
  } catch {
    return createRequire(`${execSync('npm root -g').toString().trim()}/`)('playwright')
  }
}
const { chromium } = loadPlaywright()
const srv = spawn('npx', ['vite', '--port', '5198', '--strictPort'], { stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch('http://localhost:5198')).ok) break } catch {} await new Promise(r => setTimeout(r, 500)) }
const exe = '/opt/pw-browsers/chromium/chrome-linux/chrome'
const b = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined })
const page = await (await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage()
await installSeed(page)
await page.goto('http://localhost:5198/#/'); await page.waitForTimeout(2500)
await page.evaluate(async () => {
  const { api } = await import('/src/lib/api.ts'); const [a] = await api.listAccounts(); const e = (await api.listInstruments()).find(i => i.symbol === 'EURUSD'); const now = Date.now()
  for (let i = 0; i < 3; i++) { const t = now - (40 - i * 12) * 60000; await api.createTrade({ accountId: a.id, instrumentId: e.id, direction: 'long', size: '0.1', entryPrice: '1.0800', exitPrice: '1.0780', entryTime: t, exitTime: t + 480000, tzOffsetMin: 0, plannedSl: '1.0780', fees: '0', thesis: '', postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [] }) }
})
const go = async h => { await page.evaluate(p => { location.hash = p }, h); await page.waitForTimeout(700) }
await go('/alerts'); await go('/'); await page.waitForTimeout(800)
const res = []
const inForm = () => page.evaluate(() => !!document.activeElement?.closest('[aria-label="Faire une pause"]'))
// bannière : ouverture au clavier
await page.getByRole('button', { name: 'Faire une pause' }).first().focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
res.push(['bannière : le focus entre dans le formulaire', await inForm()])
let left = false; for (let i = 0; i < 30; i++) { await page.keyboard.press('Tab'); if (!(await inForm())) { left = true; break } }
res.push(['Tab : le focus sort du formulaire (pas de piège)', left])
await page.getByRole('button', { name: '15 min' }).focus(); await page.keyboard.press('Escape'); await page.waitForTimeout(300)
res.push(['Échap ferme le formulaire', (await page.getByRole('button', { name: 'Commencer la pause' }).count()) === 0])
// barre du haut
await page.getByRole('button', { name: 'Pause', exact: true }).first().focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
res.push(['barre : formulaire ouvert au clavier', (await page.getByTestId('pause-popover').count()) === 1])
left = false; for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.activeElement?.closest('[data-testid=pause-popover]')))) { left = true; break } }
res.push(['barre : Tab sort du panneau (pas de piège)', left])
await page.getByRole('button', { name: '15 min' }).focus(); await page.keyboard.press('Escape'); await page.waitForTimeout(300)
res.push(['barre : Échap ferme', (await page.getByTestId('pause-popover').count()) === 0])
// Entrée dans le mot ne soumet pas le trade : formulaire de trade
await go('/trades/new')
await page.getByRole('button', { name: 'Faire une pause' }).first().click().catch(() => {}); await page.waitForTimeout(300)
await page.getByPlaceholder(/Je respire/).fill('test'); await page.keyboard.press('Enter'); await page.waitForTimeout(600)
res.push(['formulaire : Entrée démarre la pause, sans enregistrer le trade', page.url().includes('/trades/new') && (await page.getByTestId('pause-chip').count()) === 1])
res.push(['formulaire : encadré avec « Je continue quand même »', (await page.getByRole('button', { name: 'Je continue quand même' }).count()) === 1])
for (const r of res) console.log(r[1] ? 'ok  ' : 'ÉCHEC', r[0])
await b.close(); srv.kill()
process.exit(res.every(r => r[1]) ? 0 : 1)
