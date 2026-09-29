import type { TradeView } from '../types/trade'
import type { TradeCardFigures } from '../types/tradeCard'

/**
 * Lot 24 : carte de trade dans le navigateur. SIMULATION, elle ne fait pas foi : dans l'application,
 * R, rendement et P&L viennent de pulse-core (`stats/trade_card.rs`). Ici le rendement est le P&L net
 * divisé par le solde à l'entrée du faux moteur de risque (pulse-core prend le solde juste avant la sortie :
 * identique sauf si un autre trade se clôture entre l'entrée et la sortie). L'« enregistrement » déclenche
 * un téléchargement du navigateur, pour pouvoir regarder le PNG produit.
 */
export interface TradeCardMockDeps {
  getTrade: (id: number) => Promise<TradeView>
  /** Solde du compte à l'entrée du trade (`null` s'il est inconnu). */
  balanceAtEntry: (trade: TradeView) => string | null
}

export function createTradeCardMock(deps: TradeCardMockDeps) {
  return {
    getTradeCardFigures: async (tradeId: number): Promise<TradeCardFigures> => {
      const t = await deps.getTrade(tradeId)
      const f = t.figures
      if (!f) return { tradeId, closed: false, outcome: null, rMultiple: null, returnFraction: null, netPnl: null }
      const balance = deps.balanceAtEntry(t)
      const returnFraction = balance !== null && Number(balance) > 0 ? Number(f.netPnl) / Number(balance) : null
      return { tradeId, closed: true, outcome: f.outcome, rMultiple: f.rMultiple, returnFraction, netPnl: f.netPnl }
    },
    pickPngPath: async (defaultName: string): Promise<string | null> => defaultName,
    saveTradeCardImage: async (path: string, image: string): Promise<number> => {
      const bin = atob(image.includes(',') ? image.split(',')[1] : image)
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
      if (typeof document !== 'undefined') {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
        a.download = path
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      }
      return bytes.length
    },
  }
}
