#!/usr/bin/env node
/**
 * Audit visuel réutilisable (lot 26) : parcourt les pages de Pulse dans Chromium headless (faux backend du
 * navigateur), à 1280×720, 1440×900 et 1920×1080 (et 2560×1440 avec --wide), dans deux états : « vide » (aucune
 * donnée) et « chargé » (jeu de démonstration semé par scripts/seed-demo.mjs).
 *
 * Contrôles automatiques : défilement horizontal de la page, éléments qui sortent de la fenêtre, texte coupé
 * sans info-bulle, cibles trop petites, boutons-icônes sans nom accessible, focus clavier invisible, tailles des
 * titres de page. Code de sortie 1 s'il y a un défilement horizontal de PAGE (ce qui ne doit jamais arriver).
 *
 * Usage : node scripts/visual-audit.mjs [--out DIR] [--shots DIR] [--url http://localhost:5199] [--wide] [--sizes 1440x900,1920x1080] [--only regex]
 * Prérequis : playwright (npm i -g playwright ; Chromium dans /opt/pw-browsers ou PLAYWRIGHT_BROWSERS_PATH).
 */
import { spawn, execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { installSeed, readSeed } from './seed-demo.mjs'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def
}
const flag = (name) => args.includes(`--${name}`)

function loadPlaywright() {
  const req = createRequire(import.meta.url)
  try {
    return req('playwright')
  } catch {
    const root = execSync('npm root -g').toString().trim()
    return createRequire(`${root}/`)('playwright')
  }
}

export const SIZES = [
  [1280, 720],
  [1440, 900],
  [1920, 1080],
]

/** Routes parcourues. `seedId` est remplacé par l'identifiant du premier trade. */
export const ROUTES = [
  ['dashboard', '/'],
  ['trades', '/trades'],
  ['trade-nouveau', '/trades/new'],
  ['trade-detail', '/trades/:id'],
  ['trade-modifier', '/trades/:id/edit'],
  ['calendrier', '/calendar'],
  ['calendrier-eco', '/calendar/news'],
  ['journal', '/journal'],
  ['discipline', '/discipline'],
  ['comportement', '/behavior'],
  ...[
    ['assets', 'Par actif'], ['fees', 'Frais'], ['strategies', 'Stratégies'], ['execution', 'Système / discrétionnaire'],
    ['opportunity', 'Coût d’opportunité'], ['year', 'Année précédente'], ['duration', 'Temps en position'], ['scaling', 'Scaling'],
  ].map(([t, label]) => [`analyses-${t}`, '/analytics', label]),
  ['comparaisons', '/comparisons'],
  ['insights', '/insights'],
  ['coach', '/coach'],
  ['calculateur', '/sizing'],
  ['objectifs', '/goals'],
  ['objectifs-comportement', '/goals?type=process'],
  ['replay', '/replay'],
  ['alertes', '/alerts'],
  ['parametres', '/settings'],
]

const go = async (page, hash) => {
  await page.evaluate((p) => { location.hash = p }, hash)
  await page.waitForTimeout(500)
}
const clickText = async (page, text) => {
  await page.getByText(text, { exact: false }).first().click({ timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(400)
}

/** États et boîtes de dialogue : chacun prépare la page, puis on l'inspecte et on la photographie. */
export const SCENARIOS = [
  ['dashboard-edition', async (page) => { await go(page, '/'); await clickText(page, 'Modifier le dashboard') }],
  ['dashboard-bibliotheque', async (page) => { await go(page, '/'); await clickText(page, 'Modifier le dashboard'); await clickText(page, 'Ajouter un widget') }],
  ['carte-de-trade', async (page, id) => { await go(page, `/trades/${id}`); await clickText(page, 'Créer une carte') }],
  ['settings-securite', async (page) => { await go(page, '/settings'); await clickText(page, 'Activer le verrouillage…') }],
  ['settings-donnees-pdf', async (page) => { await go(page, '/settings'); await page.evaluate(() => [...document.querySelectorAll('h2')].find((h) => /PDF|Données/.test(h.textContent))?.scrollIntoView()) }],
  // Lot 28 : source Forex Factory (simulation du navigateur, aucune requête), dans l'ordre d'un premier usage.
  ['news-ff-consentement', async (page) => {
    await go(page, '/settings')
    const on = page.getByRole('switch', { name: 'Calendrier économique' })
    if ((await on.getAttribute('aria-checked')) !== 'true') await on.click()
    await page.waitForTimeout(300)
    await page.getByLabel(/Forex Factory\s:\sexport hebdomadaire/).check()
    await page.getByTestId('news-ff').scrollIntoViewIfNeeded()
    await page.evaluate(() => document.getElementById('news')?.scrollIntoView())
    await page.waitForTimeout(300)
  }],
  ['news-ff-test', async (page) => {
    await page.getByLabel(/J’ai lu ces points/).check()
    await page.getByRole('button', { name: 'Tester la source' }).click()
    await page.getByTestId('news-preview').waitFor({ timeout: 3000 }).catch(() => {})
    await page.evaluate(() => document.querySelector('[data-testid="news-test"]')?.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(300)
  }],
  ['news-ff-calendrier', async (page) => {
    await page.getByRole('button', { name: 'Enregistrer la source et ces événements' }).click().catch(() => {})
    await page.waitForTimeout(500)
    await go(page, '/calendar/news')
    await page.waitForTimeout(400)
  }],
  ['news-ff-trop-tot', async (page) => {
    await page.getByRole('button', { name: 'Actualiser' }).click().catch(() => {})
    await page.waitForTimeout(400)
  }],
  ['news-ff-widget', async (page) => {
    // Widget « Prochaines news » ajouté en mode édition (il n'est dans aucun modèle), rempli par la source Forex Factory.
    await go(page, '/')
    await clickText(page, 'Modifier le dashboard')
    await clickText(page, 'Ajouter un widget')
    await page.getByRole('button', { name: 'Temporel', exact: true }).click().catch(() => {})
    await page.getByRole('button', { name: /Ajouter Prochaines news/ }).first().click().catch(() => {})
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: /Fermer/ }).first().click().catch(() => {})
    await page.waitForTimeout(300)
    await clickText(page, 'Enregistrer comme copie')
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click().catch(() => {})
    await page.waitForTimeout(600)
    await page.getByText('Prochaines news', { exact: true }).last().evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {})
    await page.waitForTimeout(600)
  }],
  // Lot 30 : Ma liste d'émotions, dans l'ordre d'un usage réel (formulaire, catalogue, saisie libre, retrait, Paramètres).
  ['emotions-formulaire', async (page) => {
    await go(page, '/trades/new')
    await page.evaluate(() => document.querySelector('[aria-label="Avant"]')?.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(300)
  }],
  ['emotions-catalogue', async (page) => {
    await page.getByRole('button', { name: 'Ajouter une émotion' }).first().click().catch(() => {})
    await page.waitForTimeout(400)
    await page.evaluate(() => document.getElementById('emotions-catalogue')?.scrollIntoView({ block: 'start' }))
    await page.waitForTimeout(300)
  }],
  ['emotions-saisie-libre', async (page) => {
    await page.getByRole('button', { name: 'Ajouter Avidité à Ma liste' }).click().catch(() => {})
    await page.getByLabel('Une émotion qui manque').fill('Méfiance').catch(() => {})
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click().catch(() => {})
    await page.waitForTimeout(400)
    await page.getByLabel('Une émotion qui manque').fill('   ').catch(() => {})
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click().catch(() => {})
    await page.waitForTimeout(300)
    await page.getByLabel('Une émotion qui manque').evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {})
    await page.waitForTimeout(300)
  }],
  ['emotions-retrait-confirmation', async (page) => {
    await page.getByRole('button', { name: 'Retirer Doute de Ma liste' }).click().catch(() => {})
    await page.waitForTimeout(300)
    await page.getByRole('group', { name: /Retirer/ }).first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {})
    await page.waitForTimeout(300)
  }],
  ['emotions-retrait-fait', async (page) => {
    await page.getByRole('button', { name: 'Retirer de ma liste' }).click().catch(() => {})
    await page.waitForTimeout(400)
    await page.getByRole('status').filter({ hasText: 'retirée de Ma liste' }).evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {})
    await page.waitForTimeout(300)
  }],
  ['emotions-parametres', async (page) => {
    await go(page, '/settings')
    await page.evaluate(() => document.getElementById('emotions')?.scrollIntoView())
    await page.waitForTimeout(400)
  }],
  // Lot 34 : objectifs de comportement, dans l'ordre d'un usage réel (vide, création, rempli, semaine passée, widget).
  ['objectifs-comportement-vide', async (page) => { await go(page, '/goals?type=process&kind=week'); await page.waitForTimeout(300) }],
  ['objectifs-comportement-creation', async (page) => {
    await go(page, '/goals?type=process&kind=week')
    await page.getByRole('button', { name: 'Autre objectif…' }).click().catch(() => {})
    await page.waitForTimeout(300)
    await page.getByLabel(/Cible \(au moins\)|Plafond \(au plus\)/).fill('1,5').catch(() => {})
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click().catch(() => {})
    await page.waitForTimeout(300)
  }],
  ['objectifs-comportement-rempli', async (page) => {
    await page.keyboard.press('Escape')
    await page.evaluate(seedProcessGoals)
    await go(page, '/goals?type=process&kind=month')
    await go(page, '/goals?type=process&kind=week')
    await page.waitForTimeout(500)
  }],
  ['objectifs-comportement-precedente', async (page) => {
    await page.getByRole('button', { name: 'Semaine précédente' }).click().catch(() => {})
    await page.waitForTimeout(500)
  }],
  ['objectifs-comportement-widget', async (page) => {
    // Widget « Objectifs de comportement » ajouté en mode édition (il n'est dans aucun modèle), puis enregistré en copie.
    await go(page, '/')
    const button = (name) => page.getByRole('button', { name, exact: true }).first().click({ timeout: 3000 }).catch(() => {})
    await page.getByRole('button', { name: /^Modifier/ }).first().click({ timeout: 3000 }).catch(() => {})
    await button('Ajouter un widget')
    await button('Suivi')
    await button('Ajouter Objectifs de comportement')
    await page.waitForTimeout(400)
    await button('Fermer la bibliothèque')
    await button('Enregistrer comme copie')
    await page.waitForTimeout(300)
    await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer', exact: true }).click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(800)
    await page.getByText('Objectifs de comportement', { exact: true }).last().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {})
    await page.waitForTimeout(600)
  }],
  ['ecran-verrouillage', async (page) => {
    await go(page, '/settings')
    await clickText(page, 'Activer le verrouillage…')
    const pw = page.locator('input[type=password]')
    if ((await pw.count()) >= 2) {
      await pw.nth(0).fill('un mot de passe assez long 123')
      await pw.nth(1).fill('un mot de passe assez long 123')
      await page.locator('input[type=checkbox]').last().check().catch(() => {})
      await clickText(page, 'Chiffrer et activer')
      await page.waitForTimeout(800)
      await clickText(page, 'Verrouiller maintenant')
      await page.waitForTimeout(600)
    }
  }],
]

/**
 * Lot 34 : objectifs de comportement qui montrent chaque statut sur la semaine en cours et la précédente (faux backend).
 * Deux trades clôturés aujourd'hui (dont un sans stop), limite de 1 trade par jour (surtrading), pas de risque max
 * (« Réglage requis »), une entrée de journal aujourd'hui, et des objectifs sur les semaines précédentes pour les séries.
 */
async function seedProcessGoals() {
  const { api } = await import('/src/lib/api.ts')
  const { currentPeriodKey, shiftPeriod } = await import('/src/lib/processPeriods.ts')
  const tz = -new Date().getTimezoneOffset()
  const now = Date.now()
  const [account] = await api.listAccounts()
  const eur = (await api.listInstruments()).find((i) => i.symbol === 'EURUSD')
  const rules = await api.listRules()
  const trade = (entry, sl, respected) => api.createTrade({
    accountId: account.id, instrumentId: eur.id, direction: 'long', size: '0.1', entryPrice: '1.0850', exitPrice: '1.0870',
    entryTime: entry, exitTime: entry + 20 * 60_000, tzOffsetMin: tz, plannedSl: sl, fees: '0.8', thesis: '', postMortem: '',
    tagIds: [], emotions: [], checklist: [], planFollowed: 'yes', ruleChecks: rules.map((r, k) => ({ ruleId: r.id, respected: respected || k > 0 })),
  })
  const start = new Date(now)
  start.setHours(0, 5, 0, 0)
  await trade(start.getTime(), '1.0830', true)
  await trade(start.getTime() + 25 * 60_000, null, false)
  const s = await api.getBehaviorSettings()
  await api.setBehaviorSettings({ ...s, maxTradesPerDay: 1, maxRiskPercent: null })
  const today = new Date(now - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
  await api.saveJournalEntry({ day: today, mood: 4, sleepQuality: 4, fatigue: 2, lateHours: false, wentWell: 'Stops posés.', toImprove: '', notes: '' })
  const week = currentPeriodKey('week', now, tz)
  const goals = [['no_stop_trades', '5'], ['overtrading_days', '0'], ['revenge_trades', '1'], ['risk_breaches', '0'], ['rules_respect_rate', '90'], ['plan_follow_rate', '80'], ['journal_days', '1']]
  for (const [metric, target] of goals) await api.setProcessGoal({ periodKind: 'week', periodKey: week, metric, target })
  for (let k = 1; k <= 3; k++) {
    const key = shiftPeriod('week', week, -k)
    for (const [metric, target] of [['no_stop_trades', '10'], ['journal_days', '1'], ['rules_respect_rate', '100'], ['revenge_trades', '0']]) {
      await api.setProcessGoal({ periodKind: 'week', periodKey: key, metric, target }).catch(() => {})
    }
  }
}

async function scenario(page, run, tradeId) {
  await run(page, tradeId)
  return page.evaluate(inspect)
}

/** Contrôles exécutés dans la page. */
function inspect() {
  const vw = window.innerWidth
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0
  }
  const desc = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${txt ? ` « ${txt} »` : ''}`
  }
  const inHScroll = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true
    }
    return false
  }
  const scroller = document.querySelector('main .overflow-y-auto')
  const pageOverflowX =
    document.documentElement.scrollWidth > vw + 1 || (scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : false)

  const all = [...document.querySelectorAll('body *')].filter(visible)
  const outside = all
    .filter((el) => el.getBoundingClientRect().right > vw + 1 && !inHScroll(el))
    .slice(0, 8)
    .map(desc)
  const clipped = all
    .filter((el) => {
      if (el.children.length > 0 && el.tagName !== 'SPAN' && el.tagName !== 'A') return false
      if (!(el.textContent || '').trim()) return false
      const cs = getComputedStyle(el)
      const cuts = cs.overflow !== 'visible' || cs.textOverflow === 'ellipsis'
      if (!cuts || el.scrollWidth <= el.clientWidth + 1) return false
      return !el.classList.contains('sr-only') && !el.getAttribute('title') && !el.closest('[title]') && !el.closest('[aria-label]')
    })
    .slice(0, 8)
    .map(desc)
  const interactive = all.filter((el) => el.matches('button, a[href], [role="button"], [role="tab"], input:not([type=hidden]), select, textarea'))
  const small = interactive
    .filter((el) => {
      const r = el.getBoundingClientRect()
      return r.height < 24 || r.width < 24
    })
    .filter((el) => !(el.matches('input[type=checkbox], input[type=radio]') && el.closest('label')))
    .slice(0, 8)
    .map((el) => `${desc(el)} (${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)})`)
  const unnamed = interactive
    .filter((el) => {
      if (el.matches('input, select, textarea')) {
        return !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.id && document.querySelector(`label[for="${el.id}"]`) || el.closest('label') || el.getAttribute('title'))
      }
      const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()
      return !name
    })
    .slice(0, 8)
    .map(desc)
  const h1 = [...document.querySelectorAll('h1')].filter(visible).map((el) => `${getComputedStyle(el).fontSize}/${getComputedStyle(el).fontWeight}`)
  return { pageOverflowX, outside, clipped, small, unnamed, h1, scrollWidth: document.documentElement.scrollWidth }
}

/** Tab ×N : le focus doit se voir (contour ou anneau). Renvoie les éléments dont le focus est invisible. */
async function focusCheck(page, n = 14) {
  const bad = []
  await page.evaluate(() => document.activeElement && document.activeElement.blur())
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab')
    const r = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const cs = getComputedStyle(el)
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
      const ring = cs.boxShadow !== 'none' && /\d+px/.test(cs.boxShadow) && !/inset\s+0px\s+1px/.test(cs.boxShadow)
      const border = el.matches('.input, .control') && /139, 127, 232/.test(cs.borderColor)
      const name = `${el.tagName.toLowerCase()} « ${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)} »`
      return { ok: outline || ring || border, name }
    })
    if (r && !r.ok) bad.push(r.name)
  }
  return bad
}

async function main() {
  const { chromium } = loadPlaywright()
  const outDir = opt('out', 'audit-out')
  const shotDir = opt('shots', null)
  const only = opt('only', null) ? new RegExp(opt('only', '')) : null
  mkdirSync(outDir, { recursive: true })
  if (shotDir) mkdirSync(shotDir, { recursive: true })

  let url = opt('url', null)
  let server = null
  if (!url) {
    const port = 5199
    server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
    url = `http://localhost:${port}`
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(url)).ok) break
      } catch {}
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined
  const browser = await chromium.launch({ executablePath: exe && existsSync(`${exe}/chrome-linux/chrome`) ? `${exe}/chrome-linux/chrome` : undefined })
  const chosen = opt('sizes', null)?.split(',').map((x) => x.split('x').map(Number))
  const sizes = chosen ?? (flag('wide') ? [...SIZES, [2560, 1440]] : SIZES)
  const report = []
  let overflowFail = 0

  for (const [w, h] of sizes) {
    for (const state of ['vide', 'charge']) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'fr-FR' })
      const page = await ctx.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
      if (state === 'charge') await installSeed(page)
      await page.goto(`${url}/#/`)
      await page.waitForTimeout(state === 'charge' ? 2500 : 600)
      const tradeId = state === 'charge' ? ((await readSeed(page))?.firstTradeId ?? 1) : 1
      for (const [name, path, click] of ROUTES) {
        if (only && !only.test(name)) continue
        await page.evaluate((p) => { location.hash = p }, path.replace(':id', String(tradeId)))
        await page.waitForTimeout(500)
        if (click) {
          await page.getByRole('button', { name: click, exact: false }).first().click().catch(() => {})
          await page.waitForTimeout(400)
        }
        const res = await page.evaluate(inspect)
        const key = `${name}-${state}-${w}x${h}`
        if (shotDir) await page.screenshot({ path: `${shotDir}/${key}.png` }) // avant le contrôle du focus, qui fait défiler la barre latérale
        res.focusInvisible = await focusCheck(page)
        if (res.pageOverflowX) overflowFail++
        report.push({ key, page: name, state, size: `${w}x${h}`, errors: [...errors], ...res })
        errors.length = 0
      }
      if (state === 'charge') {
        for (const [name, run] of SCENARIOS) {
          if (only && !only.test(name)) continue
          const res = await scenario(page, run, tradeId)
          const key = `${name}-${state}-${w}x${h}`
          if (shotDir) await page.screenshot({ path: `${shotDir}/${key}.png` })
          if (res.pageOverflowX) overflowFail++
          report.push({ key, page: name, state, size: `${w}x${h}`, errors: [], focusInvisible: [], ...res })
        }
      }
      await ctx.close()
    }
  }
  await browser.close()
  if (server) server.kill()
  writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 1))
  const bad = report.filter((r) => r.pageOverflowX || r.outside.length || r.clipped.length || r.errors.length)
  console.log(`${report.length} vues, ${bad.length} avec défaut probable, ${overflowFail} avec défilement horizontal de page.`)
  for (const r of bad.slice(0, 60)) console.log(`- ${r.key}: ${r.pageOverflowX ? 'DÉFILEMENT-H ' : ''}${r.outside.length ? `dehors:${r.outside.length} ` : ''}${r.clipped.length ? `coupé:${r.clipped.length} ` : ''}${r.errors.length ? `erreurs:${r.errors[0]}` : ''}`)
  process.exit(overflowFail > 0 ? 1 : 0)
}

// Lancé directement seulement : scripts/capture-lot34.mjs importe SCENARIOS sans lancer l'audit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(2)
  })
}
