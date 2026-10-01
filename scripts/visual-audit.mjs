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
  // Lot 31 : analyse avant trading (les trois onglets ; « vide » = aucune donnée, « chargé » = jeu de démonstration).
  ['analyse-seance', '/analysis'],
  ['analyse-idees', '/analysis?tab=ideas'],
  ['analyse-archives', '/analysis?tab=archives'],
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
  // Lot 33 : état vide = aucun compte prop ; chargé = compte prop sans règles (le jeu de démonstration n'en a pas).
  ['prop', '/prop'],
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
  // Lot 33 : suivi prop firm. Règles et trades ajoutés au compte « Prop challenge » par l'API simulée, APRÈS le
  // parcours des pages (les autres captures « chargées » ne changent pas). Chaque étape aggrave la perte du jour :
  // ok → attention (≥ 70 %) → critique (≥ 90 %) → atteinte (≥ 100 %).
  ['prop-sans-regles', async (page) => { await go(page, '/'); await go(page, '/prop') }],
  ['prop-editeur', async (page) => {
    await go(page, '/prop')
    await page.getByRole('button', { name: 'Paramétrer les règles' }).first().click().catch(() => {})
    await page.waitForTimeout(300)
    await page.getByLabel('Heure', { exact: true }).fill('17:00').catch(() => {})
    await page.getByTestId('prop-dailyLoss-enable').click().catch(() => {})
    await page.waitForTimeout(200)
  }],
  ['prop-editeur-erreurs', async (page) => {
    await page.getByRole('button', { name: 'Enregistrer les règles' }).click().catch(() => {})
    await page.waitForTimeout(300)
  }],
  ['prop-statut-ok', async (page) => {
    await page.keyboard.press('Escape')
    await propSeed(page, 'ok')
  }],
  ['prop-statut-attention', async (page) => { await propSeed(page, 'warning') }],
  ['prop-statut-critique', async (page) => { await propSeed(page, 'critical') }],
  ['prop-statut-atteinte', async (page) => { await propSeed(page, 'reached') }],
  ['prop-widget', async (page) => {
    // Widget « Prop firm » ajouté en mode édition ; la barre du haut est sur « tous les comptes » : il lit le seul compte prop.
    await go(page, '/')
    await page.getByRole('button', { name: 'Modifier le dashboard' }).first().click().catch(() => {})
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Ajouter un widget' }).first().click().catch(() => {})
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Suivi', exact: true }).click().catch(() => {})
    await page.getByRole('button', { name: /Ajouter Prop firm/ }).first().click().catch(() => {})
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: /Fermer/ }).first().click().catch(() => {})
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Enregistrer comme copie' }).first().click().catch(() => {})
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click().catch(() => {})
    await page.waitForTimeout(600)
    await page.getByTestId('prop-widget').last().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {})
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
  // Lot 31 : analyse avant trading, dans l'ordre d'un usage réel (séance remplie, revue du matin, report, archives, Paramètres, trade).
  ['analyse-seance-remplie', async (page) => {
    await go(page, '/analysis')
    await page.getByLabel('Niveaux importants', { exact: false }).first().fill('4 250 – 4 300 (résistance hebdo)', { timeout: 3000 }).catch(() => {})
    await page.getByRole('group', { name: 'Journalière' }).getByRole('button', { name: 'Haussière' }).click({ timeout: 3000 }).catch(() => {})
    await page.getByRole('button', { name: 'Conviction 7 sur 10' }).click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(300)
  }],
  ['analyse-seance-vide-refusee', async (page) => {
    await go(page, '/analysis')
    await page.getByRole('button', { name: 'Enregistrer l’analyse' }).click({ timeout: 3000 }).catch(() => {})
    await page.getByText('une analyse vide n’est pas enregistrée').first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {})
    await page.waitForTimeout(300)
  }],
  ['analyse-banniere-revue', async (page) => { await go(page, '/goals') }],
  ['analyse-revue-matin', async (page) => { await go(page, '/analysis?tab=ideas') }],
  ['analyse-report-menu', async (page) => {
    await go(page, '/analysis?tab=ideas')
    await page.getByRole('button', { name: 'Redemander dans…' }).first().click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(300)
    await page.getByRole('combobox', { name: /Redemander dans/ }).first().click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(300)
  }],
  ['analyse-report-libre-invalide', async (page) => {
    await page.getByRole('option', { name: 'Un autre nombre de jours…' }).click({ timeout: 3000 }).catch(() => {})
    await page.getByLabel('Nombre de jours (1 à 30)').first().fill('45', { timeout: 3000 }).catch(() => {})
    await page.getByRole('button', { name: 'Reporter', exact: true }).first().click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(300)
  }],
  ['analyse-report-fait', async (page) => {
    await page.getByLabel('Nombre de jours (1 à 30)').first().fill('5', { timeout: 3000 }).catch(() => {})
    await page.getByRole('button', { name: 'Reporter', exact: true }).first().click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(500)
    await page.getByText('Idées reportées').first().evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {})
    await page.waitForTimeout(300)
  }],
  ['analyse-cloture', async (page) => {
    await go(page, '/analysis?tab=ideas')
    await page.getByRole('button', { name: 'Clôturer', exact: true }).first().click({ timeout: 3000 }).catch(() => {})
    await page.getByRole('button', { name: 'Ça a fonctionné' }).first().click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(300)
  }],
  ['analyse-idee-nouvelle', async (page) => {
    await go(page, '/analysis?tab=ideas&new=1')
    await page.getByRole('button', { name: 'Enregistrer l’idée' }).click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(300)
  }],
  ['analyse-archives-ouvertes', async (page) => {
    await go(page, '/analysis?tab=archives')
    await page.getByRole('button', { name: /analyse/ }).filter({ hasText: /\(1 analyse\)/ }).first().click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(300)
  }],
  ['analyse-parametres', async (page) => {
    await go(page, '/settings')
    await page.evaluate(() => document.getElementById('analysis')?.scrollIntoView())
    await page.waitForTimeout(400)
  }],
  ['analyse-formulaire-trade', async (page) => {
    await go(page, '/trades/new')
    await page.getByRole('button', { name: /Analyse et idées/ }).first().click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(400)
  }],
  ['analyse-detail-trade', async (page, id) => {
    await go(page, `/trades/${id}`)
    await page.evaluate(() => document.getElementById('trade-links-title')?.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(400)
  }],
  // Lot 32 : sauvegarde automatique (faux backend : simulation, aucun fichier écrit).
  ['sauvegarde-auto-desactivee', async (page) => {
    await go(page, '/settings')
    await page.evaluate(() => document.getElementById('sauvegarde')?.scrollIntoView())
    await page.waitForTimeout(400)
  }],
  ['sauvegarde-auto-activee-erreur', async (page) => {
    await page.evaluate(async () => {
      const { api } = await import('/src/lib/api.ts')
      const { mockBackupAuto } = await import('/src/lib/mockBackend.ts')
      const tz = -new Date().getTimezoneOffset()
      await api.setAutoBackupSettings({ enabled: true, folder: 'C:\\Users\\Trader\\OneDrive - Société\\Documents\\Trading\\Pulse\\Sauvegardes automatiques', frequency: 'weekly', keep: 60 }, tz)
      mockBackupAuto.simulate({ seedBackups: { at: [Date.now() - 86_400_000 * 9, Date.now() - 86_400_000 * 2], tz }, lastSuccessAt: Date.now() - 86_400_000 * 2, lastAttemptAt: Date.now() - 60_000, lastError: 'diskFull' })
    })
    await go(page, '/')
    await go(page, '/settings')
    await page.evaluate(() => document.getElementById('sauvegarde')?.scrollIntoView())
    await page.waitForTimeout(400)
  }],
  // Lot 35 : pause volontaire, dans l'ordre d'un usage réel (choix, repère de la barre, formulaire, bannières, constat, réglages).
  ['pause-choix', async (page) => {
    await go(page, '/')
    await page.getByRole('button', { name: 'Pause', exact: true }).first().click().catch(() => {})
    await page.waitForTimeout(400)
  }],
  ['pause-active-barre', async (page) => {
    await page.getByRole('button', { name: '30 min', exact: true }).click().catch(() => {})
    await page.getByRole('button', { name: 'Commencer la pause' }).click().catch(() => {})
    await page.waitForTimeout(600)
  }],
  ['pause-formulaire', async (page) => {
    await go(page, '/trades/new')
    await page.getByText('Êtes-vous sûr', { exact: false }).first().scrollIntoViewIfNeeded().catch(() => {})
    await page.waitForTimeout(300)
  }],
  ['pause-formulaire-continuer', async (page) => {
    await page.getByRole('button', { name: 'Je continue quand même' }).click().catch(() => {})
    await page.waitForTimeout(300)
  }],
  ['pause-banniere-choix', async (page) => {
    // Fin de la pause, puis trois pertes aujourd'hui : la bannière des pertes consécutives propose « Faire une pause ».
    await page.getByRole('button', { name: 'Terminer la pause' }).first().click().catch(() => {})
    await page.waitForTimeout(400)
    await page.evaluate(async () => {
      const { api } = await import('/src/lib/api.ts')
      const [account] = await api.listAccounts()
      const eur = (await api.listInstruments()).find((i) => i.symbol === 'EURUSD')
      const now = Date.now()
      for (let i = 0; i < 3; i++) {
        const entryTime = now - (40 - i * 12) * 60_000
        await api.createTrade({
          accountId: account.id, instrumentId: eur.id, direction: 'long', size: '0.1', entryPrice: '1.0800', exitPrice: '1.0780',
          entryTime, exitTime: entryTime + 8 * 60_000, tzOffsetMin: 0, plannedSl: '1.0780', fees: '0', thesis: '', postMortem: '',
          tagIds: [], emotions: [], ruleChecks: [], checklist: [],
        })
      }
    })
    await go(page, '/alerts')
    await go(page, '/')
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: 'Faire une pause' }).first().click().catch(() => {})
    await page.waitForTimeout(400)
  }],
  ['pause-banniere-suggestion', async (page) => {
    await page.evaluate(async () => {
      const { api } = await import('/src/lib/api.ts')
      await api.setPauseSettings({ suggestAfterLosses: 2, defaultMinutes: 30 })
    })
    await go(page, '/alerts')
    await go(page, '/trades')
    await page.waitForTimeout(800)
  }],
  ['pause-comportement-avec', async (page) => {
    // Une douzaine de trades pris « pendant une pause » (pauses passées, construites chronologiquement).
    await page.evaluate(async () => {
      const { api } = await import('/src/lib/api.ts')
      const { mockPause } = await import('/src/lib/mockBackend.ts')
      await api.setPauseSettings({ suggestAfterLosses: null, defaultMinutes: 30 })
      mockPause.reset()
      const trades = (await api.listTrades()).filter((t) => t.exitTime != null).sort((a, b) => a.entryTime - b.entryTime)
      const reasons = ['loss', 'lossStreak', 'fatigue', 'emotion', 'other', null]
      for (const [i, t] of trades.filter((_, k) => k % 3 === 0).slice(0, 12).entries()) {
        const n = await mockPause.startPause({ length: { kind: 'minutes', minutes: 30 }, reason: reasons[i % reasons.length], note: i === 1 ? 'Je respire avant de revenir.' : null, tzOffsetMin: 0 }, t.entryTime - 60_000)
        if (i % 4 === 3) await mockPause.endPause(t.entryTime + 10 * 60_000)
        void n
      }
    })
    await go(page, '/behavior')
    await page.waitForTimeout(800)
    await page.getByRole('heading', { name: 'Pauses', exact: true }).evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {})
    await page.waitForTimeout(400)
  }],
  ['pause-discipline-repere', async (page) => {
    await go(page, '/discipline')
    await page.waitForTimeout(800)
    await page.getByTestId('pause-hint').evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {})
    await page.waitForTimeout(300)
  }],
  ['pause-comportement-sans', async (page) => {
    await page.evaluate(async () => {
      const { mockPause } = await import('/src/lib/mockBackend.ts')
      mockPause.reset()
    })
    await go(page, '/behavior')
    await page.waitForTimeout(800)
    await page.getByRole('heading', { name: 'Pauses', exact: true }).evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {})
    await page.waitForTimeout(400)
  }],
  ['pause-parametres', async (page) => {
    await go(page, '/settings')
    await page.evaluate(() => document.getElementById('pause')?.scrollIntoView())
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
  // Lot 37 : accès MCP (simulation du navigateur : aucune écoute), dans l'ordre d'un premier usage.
  ['mcp-desactive', async (page) => {
    await go(page, '/settings')
    await page.evaluate(() => document.getElementById('mcp')?.scrollIntoView())
    await page.waitForTimeout(300)
  }],
  ['mcp-consentement', async (page) => {
    await page.getByTestId('mcp-consent').locator('input[type=checkbox]').check().catch(() => {})
    await page.getByTestId('mcp-accounts').locator('input[type=checkbox]').first().check().catch(() => {})
    await page.evaluate(() => document.querySelector('[data-testid="mcp-consent"]')?.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(300)
  }],
  ['mcp-actif', async (page) => {
    await page.getByRole('button', { name: 'Activer l’accès' }).click().catch(() => {})
    await page.waitForTimeout(500)
    await page.evaluate(() => document.querySelector('[data-testid="mcp-state"]')?.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(300)
  }],
  ['mcp-puce-barre-du-haut', async (page) => {
    await go(page, '/')
    await page.getByTestId('mcp-chip').hover().catch(() => {})
    await page.waitForTimeout(600)
  }],
  ['mcp-journal', async (page) => {
    await go(page, '/settings')
    await page.waitForTimeout(300)
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Simuler un appel' }).click().catch(() => {})
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Voir le résultat exact' }).first().click().catch(() => {})
    await page.evaluate(() => document.querySelector('[data-testid="mcp-log"]')?.scrollIntoView({ block: 'start' }))
    await page.waitForTimeout(300)
  }],
  ['mcp-installation', async (page) => {
    await page.evaluate(() => document.querySelector('[data-testid="mcp-install"]')?.scrollIntoView({ block: 'start' }))
    await page.waitForTimeout(300)
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
 * Lot 33 : règles (capital 50 000 : perte du jour 5 % = 2 500, perte max 10 % statique, objectif 8 %, 5 jours,
 * cohérence 60 %) et trades clôturés du compte prop, puis la page /prop relue. `step` ajoute les pertes du jour.
 */
async function propSeed(page, step) {
  await page.evaluate(async (step) => {
    const { api } = await import('/src/lib/api.ts')
    const prop = (await api.listAccounts()).find((a) => a.kind === 'prop')
    const btc = (await api.listInstruments()).find((i) => i.symbol === 'BTCUSD')
    if (!prop || !btc) return
    const DAY = 86_400_000
    const now = Date.now()
    const trade = (exitTime, pnl) =>
      api.createTrade({
        accountId: prop.id, instrumentId: btc.id, direction: 'long', size: '1', multiplier: '1', entryPrice: '60000',
        exitPrice: String(60000 + pnl), entryTime: exitTime - 20 * 60_000, exitTime, tzOffsetMin: 120, plannedSl: '59000',
        fees: '0', thesis: '', postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [],
      })
    if (step === 'ok') {
      await api.setPropRules(prop.id, {
        phaseLabel: 'Évaluation 1', startedOn: new Date(now - 10 * DAY).toISOString().slice(0, 10),
        dailyLoss: { mode: 'percent', value: '5' }, dailyReference: 'initialBalance', maxLoss: { mode: 'percent', value: '10' },
        maxLossKind: 'static', trailingLocksAtInitial: false, resetTime: '00:00', resetZone: 'paris',
        profitTarget: { mode: 'percent', value: '8' }, minTradingDays: 5, consistencyMaxBestDayPercent: '60',
      })
      for (const [k, pnl] of [[4, 800], [3, 700], [2, 600], [1, 900]]) await trade(now - k * DAY, pnl)
      await trade(now - 10 * 60_000, -500)
    }
    if (step === 'warning') await trade(now - 8 * 60_000, -1300)
    if (step === 'critical') await trade(now - 6 * 60_000, -500)
    if (step === 'reached') await trade(now - 4 * 60_000, -300)
  }, step)
  await go(page, '/')
  await go(page, '/prop')
  await page.waitForTimeout(300)
}
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
