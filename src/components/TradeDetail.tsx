import { useState } from 'react';
import type { Trade } from '../types/trade';
import { computeTradePnl } from '../lib/pnl';
import { tradesStore } from '../lib/tradesStore';
import { inputClass } from './Field';

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-accent" aria-label={`${rating} sur 5`}>
      {'★'.repeat(rating)}
      <span className="text-cream/20">{'★'.repeat(Math.max(0, 5 - rating))}</span>
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-cream/50">{label}</span>
      <span className="text-sm text-cream">{value}</span>
    </div>
  );
}

const TRADE_TYPE_LABELS: Record<string, string> = {
  system: 'Système',
  discretionary: 'Discrétionnaire',
};

export function TradeDetail({
  trade,
  onUpdated,
}: {
  trade: Trade;
  onUpdated?: (trade: Trade) => void;
}) {
  const pnl = computeTradePnl(trade);
  const [priceAfterExit, setPriceAfterExit] = useState(
    trade.priceAfterExit !== undefined ? String(trade.priceAfterExit) : '',
  );
  const [saved, setSaved] = useState(false);

  function handleSavePriceAfterExit() {
    const parsed = Number(priceAfterExit);
    if (priceAfterExit.trim() === '' || !Number.isFinite(parsed)) return;
    const updated = tradesStore.update(trade.id, { priceAfterExit: parsed });
    setSaved(true);
    if (updated) onUpdated?.(updated);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold text-cream">{trade.asset}</h3>
          <p className="text-sm text-cream/60">
            {trade.date} · {trade.session} · {trade.side === 'long' ? 'Long' : 'Short'}
            {trade.tradeType && ` · ${TRADE_TYPE_LABELS[trade.tradeType]}`}
          </p>
        </div>
        <span
          className={`text-2xl font-semibold tabular-nums ${
            pnl >= 0 ? 'text-success' : 'text-danger'
          }`}
        >
          {pnl >= 0 ? '+' : ''}
          {pnl.toFixed(2)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-2xl bg-background/60 p-4 sm:grid-cols-3">
        <DetailRow label="Entrée" value={trade.entryPrice} />
        <DetailRow label="Sortie" value={trade.exitPrice} />
        <DetailRow label="Taille" value={trade.size} />
        <DetailRow label="Stop loss" value={trade.stopLoss} />
        <DetailRow label="Take profit" value={trade.takeProfit} />
        <DetailRow label="Frais" value={trade.fees} />
        <DetailRow label="Setup" value={trade.setup || '—'} />
        <DetailRow label="Timeframe" value={trade.timeframe || '—'} />
        <DetailRow label="Condition de marché" value={trade.marketCondition} />
        {(trade.entryTime || trade.exitTime) && (
          <DetailRow
            label="Horaires"
            value={`${trade.entryTime ?? '—'} → ${trade.exitTime ?? '—'}`}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <DetailRow label="Confiance avant" value={`${trade.confidenceLevel}/10`} />
        <DetailRow label="Émotion avant" value={trade.emotionBefore} />
        <DetailRow label="Émotion après" value={trade.emotionAfter} />
        <DetailRow label="Plan respecté" value={trade.followedPlan ? 'Oui' : 'Non'} />
        <DetailRow label="Note d'exécution" value={`${trade.executionQuality}/5`} />
        <DetailRow label="Notation" value={<Stars rating={trade.starRating} />} />
      </div>

      {trade.thesis && (
        <DetailRow label="Thèse d'entrée" value={<p className="whitespace-pre-wrap">{trade.thesis}</p>} />
      )}
      {trade.postMortem && (
        <DetailRow label="Post-mortem" value={<p className="whitespace-pre-wrap">{trade.postMortem}</p>} />
      )}

      <div className="flex items-end gap-3 rounded-xl bg-background/60 p-4">
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs text-cream/50" htmlFor="priceAfterExit">
            Prix après sortie (coût d'opportunité)
          </label>
          <input
            id="priceAfterExit"
            type="number"
            step="any"
            className={inputClass}
            value={priceAfterExit}
            onChange={(e) => {
              setPriceAfterExit(e.target.value);
              setSaved(false);
            }}
            placeholder="À renseigner plus tard"
          />
        </div>
        <button
          type="button"
          onClick={handleSavePriceAfterExit}
          className="rounded-full bg-gradient-to-r from-primary to-accent px-4 py-2 text-sm font-semibold text-cream transition hover:brightness-110"
        >
          Enregistrer
        </button>
        {saved && <span className="text-xs text-success">Sauvegardé</span>}
      </div>

      {trade.screenshot && (
        <div>
          <span className="mb-2 block text-xs uppercase tracking-wide text-cream/50">
            Screenshot
          </span>
          <img
            src={trade.screenshot}
            alt={`Screenshot du trade ${trade.asset}`}
            className="max-h-96 w-full rounded-xl border border-white/10 object-contain"
          />
        </div>
      )}
    </div>
  );
}
