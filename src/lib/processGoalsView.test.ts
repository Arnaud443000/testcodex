import { describe, expect, it } from 'vitest'
import { fr } from '../i18n/fr'
import type { ProcessGoalProgress, ProcessStatus } from '../types/processGoals'
import { IDS_PARAM, parseIdsParam, tradesHref } from './idsFilter'
import { goalSentence, periodTitle, processTemplates, rateText, ratioText, readTarget, statusLook, targetText, valueText } from './processGoalsView'

const t = fr.processGoals
const NB = ' '
const progress = (over: Partial<ProcessGoalProgress>): ProcessGoalProgress => ({
  goal: { id: 1, periodKind: 'week', periodKey: '2026-W38', metric: 'no_stop_trades', target: '0' },
  direction: 'atMost', unit: 'count', value: 1, numerator: null, denominator: null, tradeCount: 3, status: 'exceeded',
  requiredSetting: null, streak: 0, tradeIds: [7], days: [], ...over,
})

describe('affichage des objectifs de comportement', () => {
  it('chaque statut a un texte et une icône distincte selon le sens, jamais la couleur seule', () => {
    const all: ProcessStatus[] = ['respectedSoFar', 'exceeded', 'respected', 'reached', 'inProgress', 'missed', 'noData', 'settingRequired']
    for (const s of all) {
      expect(t.statuses[s], s).toBeTruthy()
      expect(t.statusHelp[s], s).toBeTruthy()
    }
    expect(statusLook('reached').icon).toBe('check')
    expect(statusLook('exceeded').icon).toBe('cross')
    expect(statusLook('missed').icon).toBe('cross')
    expect(statusLook('inProgress').icon).toBe('right')
    expect(statusLook('noData').icon).toBe('minus')
    expect(statusLook('settingRequired').icon).toBe('settings')
    expect(new Set(all.map((s) => t.statuses[s])).size).toBe(all.length)
  })

  it('phrases, cibles et valeurs', () => {
    expect(goalSentence(t, 'no_stop_trades', '0')).toBe('Aucun trade sans stop')
    expect(goalSentence(t, 'overtrading_days', '2')).toBe(`Au plus 2${NB}jours de surtrading`)
    expect(goalSentence(t, 'rules_respect_rate', '90.5')).toBe(`Au moins 90,5${NB}% de règles respectées`)
    expect(goalSentence(t, 'journal_days', '1')).toBe(`Au moins 1${NB}jour de journal`)
    expect(targetText(t, 'plan_follow_rate', '80')).toBe(`80${NB}%`)
    expect(targetText(t, 'revenge_trades', '1')).toBe(`1${NB}trade`)
    expect(valueText(t, progress({}))).toBe(`1${NB}trade`)
    expect(valueText(t, progress({ value: null, status: 'noData' }))).toBe('—')
    const rate = progress({ goal: { id: 2, periodKind: 'week', periodKey: '2026-W38', metric: 'rules_respect_rate', target: '90' }, unit: 'percent', value: 90.00000000000001, numerator: 9, denominator: 10 })
    expect(valueText(t, rate)).toBe(`90${NB}%`)
    expect(ratioText(t, rate)).toBe('9 coches respectées sur 10')
    expect(rateText(200 / 3)).toBe(`66,7${NB}%`)
  })

  it('titre de période : semaine ISO et mois', () => {
    expect(periodTitle(t, 'week', '2026-W38')).toEqual({ title: 'Semaine 38', range: 'du 14 sept. au 20 sept. 2026' })
    expect(periodTitle(t, 'week', '2026-W53').range).toBe('du 28 déc. au 3 janv. 2027')
    expect(periodTitle(t, 'month', '2026-09')).toEqual({ title: 'Septembre 2026', range: null })
  })

  it('lit la cible avec les bornes de pulse-core', () => {
    expect(readTarget('week', 'no_stop_trades', '0')).toEqual({ target: '0' })
    expect(readTarget('week', 'no_stop_trades', ' 3,0 ')).toEqual({ target: '3' })
    expect(readTarget('week', 'no_stop_trades', '1,5')).toEqual({ error: 'count' })
    expect(readTarget('week', 'no_stop_trades', '10 001')).toEqual({ error: 'count' })
    expect(readTarget('week', 'no_stop_trades', '-1')).toEqual({ error: 'count' })
    expect(readTarget('week', 'rules_respect_rate', '90,5')).toEqual({ target: '90.5' })
    expect(readTarget('week', 'rules_respect_rate', '0')).toEqual({ error: 'percent' })
    expect(readTarget('week', 'rules_respect_rate', '100,01')).toEqual({ error: 'percent' })
    expect(readTarget('week', 'journal_days', '8')).toEqual({ error: 'journalWeek' })
    expect(readTarget('month', 'journal_days', '31')).toEqual({ target: '31' })
    expect(readTarget('month', 'journal_days', '32')).toEqual({ error: 'journalMonth' })
    expect(readTarget('week', 'journal_days', '')).toEqual({ error: 'empty' })
    expect(readTarget('week', 'journal_days', 'abc')).toEqual({ error: 'notNumber' })
    for (const e of ['empty', 'notNumber', 'count', 'percent', 'journalWeek', 'journalMonth'] as const) expect(t.errors[e]).toBeTruthy()
  })

  it('les trois objectifs types de l’état vide', () => {
    expect(processTemplates('week')).toEqual([
      { metric: 'no_stop_trades', target: '0' },
      { metric: 'overtrading_days', target: '1' },
      { metric: 'rules_respect_rate', target: '90' },
    ])
    expect(processTemplates('month')[1].target).toBe('3')
  })
})

describe('liste de trades précise dans l’adresse', () => {
  it('lit et écrit « ?ids= »', () => {
    expect(IDS_PARAM).toBe('ids')
    expect(parseIdsParam('12,15,12')).toEqual([12, 15])
    expect(parseIdsParam(null)).toBeNull()
    expect(parseIdsParam('12,abc')).toBeNull()
    expect(parseIdsParam('0')).toBeNull()
    expect(tradesHref([3, 1, 3])).toBe('/trades?ids=3,1')
    expect(tradesHref([])).toBeNull()
  })
})
