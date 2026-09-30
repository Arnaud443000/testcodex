import type { Messages } from '../i18n'
import type { Alert, LossDetail } from '../types/alerts'
import { formatDecimal, formatDuration, formatNumber, formatR, formatRatioPercent, formatSignedMoney, formatMoney } from './format'
import { formatPercentValue } from './behaviorFormat'

/**
 * Texte d'une alerte à seuils, à partir de sa clé et de ses valeurs (renvoyées par pulse-core).
 * Aucun calcul métier : uniquement de l'affichage.
 */
export function alertMessage(t: Messages, a: Alert): string {
  const m = t.alerts.messages
  switch (a.kind) {
    case 'consecutiveLosses':
      return m.consecutiveLosses(a.count, a.threshold)
    case 'tradesPerDay':
      return (a.level === 'exceeded' ? m.tradesPerDayExceeded : m.tradesPerDayReached)(a.count, a.threshold)
    case 'tradesPerWindow':
      return (a.level === 'exceeded' ? m.tradesPerWindowExceeded : m.tradesPerWindowReached)(a.count, a.threshold, formatDuration(a.windowMin * 60_000))
    case 'dailyLoss':
    case 'weeklyLoss': {
      const [loss, pct, limits] = lossParts(t, a)
      return (a.kind === 'dailyLoss' ? m.dailyLoss : m.weeklyLoss)(loss, pct, limits)
    }
    case 'revenge':
      return m.revenge(formatDuration(a.gapMs), a.ratio === null ? '—' : `×${formatNumber(a.ratio, 2)}`, formatDecimal(a.sizeFactor))
    case 'outsideHours':
      return m.outsideHours(a.localTime, a.tradingHours.replace(/\s*-\s*/, '–'))
    case 'unusualSession':
      return m.unusualSession(a.session, a.sessionCount, a.historyCount, formatRatioPercent(a.share, 0))
    case 'noStopLoss':
      return a.open ? m.noStopLossOpen : m.noStopLossClosed
    case 'noAnalysis':
      return m.noAnalysis
    case 'newsTrade': {
      const names = a.events.map((e) => m.newsEvent(e.title, e.currency, e.parisTime))
      if (a.eventCount > a.events.length) names.push(m.newsMore(a.eventCount - a.events.length))
      const c = a.comparison
      return m.newsTrade(names.join(', '), formatR(c.newsExpectancyR, 2), formatR(c.otherExpectancyR, 2), c.newsRTradeCount, c.otherRTradeCount)
    }
  }
}

/** Résultat signé de la période, part du solde, et limites atteintes (« 3 % et 345,00 $ »). */
function lossParts(t: Messages, d: LossDetail): [string, string, string] {
  const currency = d.currency ?? 'USD'
  const limits = [
    d.percentReached ? formatPercentValue(d.thresholdPercent) : null,
    d.amountReached && d.thresholdAmount !== null ? formatMoney(d.thresholdAmount, currency) : null,
  ].filter((x): x is string => x !== null)
  return [formatSignedMoney(`-${d.loss}`, currency), d.lossPct === null ? '' : formatRatioPercent(d.lossPct), limits.join(t.alerts.messages.limitsJoin)]
}
