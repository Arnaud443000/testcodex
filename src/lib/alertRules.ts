import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import type { AlertKind } from '../types/alerts'
import type { Rule, TradeView } from '../types/trade'

/**
 * Lien alerte ↔ règles personnelles (cahier 3.6.9). Aucune règle n'est reliée à un seuil en base ; on ne devine
 * donc jamais par mots-clés. Seule correspondance évidente : pour une alerte qui vise UN trade précis, les règles
 * que le trader a lui-même marquées « non respectées » sur ce trade. Les alertes qui portent sur un ensemble de
 * trades (pertes d'affilée, limites de trades, perte du jour ou de la semaine) n'affichent rien : leur trade
 * n'est que le dernier de la série, pas la cause.
 */
const SINGLE_TRADE_KINDS: AlertKind[] = ['revenge', 'outsideHours', 'unusualSession', 'noStopLoss', 'newsTrade']

interface Linkable {
  kind: AlertKind
  tradeId: number | null
}

/** Cette alerte vise-t-elle un trade précis (donc une correspondance possible) ? */
export function isSingleTradeAlert(a: Linkable): a is Linkable & { tradeId: number } {
  return a.tradeId !== null && SINGLE_TRADE_KINDS.includes(a.kind)
}

/** Textes des règles marquées non respectées sur le trade de l'alerte, dans l'ordre des règles ; vide si rien d'évident. */
export function brokenRuleTexts(a: Linkable, trades: ReadonlyMap<number, TradeView>, rules: ReadonlyMap<number, Rule>): string[] {
  if (!isSingleTradeAlert(a)) return []
  const trade = trades.get(a.tradeId)
  if (!trade) return []
  return trade.ruleChecks
    .filter((c) => !c.respected)
    .map((c) => rules.get(c.ruleId))
    .filter((r): r is Rule => r !== undefined)
    .sort((x, y) => x.position - y.position || x.id - y.id)
    .map((r) => r.text)
}

/** Charge trades et règles une fois (et seulement s'il y a une alerte concernée), puis répond alerte par alerte. */
export function useAlertRules(alerts: Linkable[]): (a: Linkable) => string[] {
  const wanted = useMemo(() => [...new Set(alerts.filter(isSingleTradeAlert).map((a) => a.tradeId))].sort((x, y) => x - y).join(','), [alerts])
  const [data, setData] = useState<{ trades: Map<number, TradeView>; rules: Map<number, Rule> } | null>(null)

  useEffect(() => {
    if (wanted === '') return
    let live = true
    Promise.all([api.listTrades({}), api.listRules(true)])
      .then(([trades, rules]) => live && setData({ trades: new Map(trades.map((t) => [t.id, t])), rules: new Map(rules.map((r) => [r.id, r])) }))
      // Le lien est un plus : s'il ne charge pas, l'alerte s'affiche sans lui.
      .catch(() => live && setData(null))
    return () => {
      live = false
    }
  }, [wanted])

  return (a) => (data ? brokenRuleTexts(a, data.trades, data.rules) : [])
}
