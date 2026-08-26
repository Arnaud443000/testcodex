import { useMemo, useState } from 'react';
import type { Trade } from '../types/trade';
import type { MissedTrade } from '../types/missedTrade';
import { tradesStore } from '../lib/tradesStore';
import { missedTradesStore } from '../lib/missedTradesStore';
import { computeTradePnl } from '../lib/pnl';
import { downloadCsv, tradesToCsv } from '../lib/csv';
import { inputClass } from '../components/Field';
import { Modal } from '../components/Modal';
import { TradeForm } from '../components/TradeForm';
import { TradeDetail } from '../components/TradeDetail';
import { MissedTradesList } from '../components/MissedTradesList';

type SortDirection = 'asc' | 'desc';

export function TradesPage() {
  const [trades, setTrades] = useState<Trade[]>(() => tradesStore.getAll());
  const [missedTrades, setMissedTrades] = useState<MissedTrade[]>(() =>
    missedTradesStore.getAll(),
  );

  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [assetFilter, setAssetFilter] = useState('');
  const [setupFilter, setSetupFilter] = useState('');
  const [sessionFilter, setSessionFilter] = useState('');

  const [showNewTrade, setShowNewTrade] = useState(false);
  const [showMissed, setShowMissed] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);

  function refreshTrades() {
    setTrades(tradesStore.getAll());
  }

  function refreshMissedTrades() {
    setMissedTrades(missedTradesStore.getAll());
  }

  const sessions = useMemo(
    () => Array.from(new Set(trades.map((t) => t.session))).filter(Boolean),
    [trades],
  );

  const visibleTrades = useMemo(() => {
    const filtered = trades.filter((trade) => {
      if (
        assetFilter &&
        !trade.asset.toLowerCase().includes(assetFilter.toLowerCase())
      ) {
        return false;
      }
      if (
        setupFilter &&
        !trade.setup.toLowerCase().includes(setupFilter.toLowerCase())
      ) {
        return false;
      }
      if (sessionFilter && trade.session !== sessionFilter) {
        return false;
      }
      return true;
    });

    return filtered.sort((a, b) => {
      const diff = a.date.localeCompare(b.date);
      return sortDirection === 'asc' ? diff : -diff;
    });
  }, [trades, assetFilter, setupFilter, sessionFilter, sortDirection]);

  function handleExportCsv() {
    downloadCsv('pulse-trades.csv', tradesToCsv(visibleTrades));
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-cream">Pulse — Trades</h1>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setShowMissed(true)}
            className="text-sm font-medium text-accent underline decoration-accent/40 underline-offset-4 hover:text-cream"
          >
            Voir les trades non pris
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={visibleTrades.length === 0}
            className="rounded-full bg-cream px-4 py-2 text-sm font-semibold text-background transition hover:brightness-95 disabled:opacity-40"
          >
            Exporter
          </button>
          <button
            type="button"
            onClick={() => setShowNewTrade(true)}
            className="rounded-full bg-gradient-to-r from-primary to-accent px-5 py-2 text-sm font-semibold text-cream shadow-lg shadow-primary/30 transition hover:brightness-110"
          >
            + Nouveau trade
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-3 rounded-2xl border border-white/10 bg-surface/40 p-4">
        <input
          className={`${inputClass} flex-1 min-w-[160px]`}
          placeholder="Filtrer par actif"
          value={assetFilter}
          onChange={(e) => setAssetFilter(e.target.value)}
        />
        <input
          className={`${inputClass} flex-1 min-w-[160px]`}
          placeholder="Filtrer par setup"
          value={setupFilter}
          onChange={(e) => setSetupFilter(e.target.value)}
        />
        <select
          className={`${inputClass} min-w-[160px]`}
          value={sessionFilter}
          onChange={(e) => setSessionFilter(e.target.value)}
        >
          <option value="">Toutes les sessions</option>
          {sessions.map((session) => (
            <option key={session} value={session}>
              {session}
            </option>
          ))}
        </select>
      </div>

      {visibleTrades.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-surface/40 px-4 py-10 text-center text-sm text-cream/50">
          {trades.length === 0
            ? 'Aucun trade enregistré. Ajoute ton premier trade pour commencer.'
            : 'Aucun trade ne correspond aux filtres.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-surface/40">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-cream/50">
                <th className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() =>
                      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
                    }
                    className="flex items-center gap-1 hover:text-cream"
                  >
                    Date {sortDirection === 'asc' ? '↑' : '↓'}
                  </button>
                </th>
                <th className="px-4 py-3">Actif</th>
                <th className="px-4 py-3">Sens</th>
                <th className="px-4 py-3">Setup</th>
                <th className="px-4 py-3">Session</th>
                <th className="px-4 py-3 text-right">PnL</th>
              </tr>
            </thead>
            <tbody>
              {visibleTrades.map((trade) => {
                const pnl = computeTradePnl(trade);
                return (
                  <tr
                    key={trade.id}
                    onClick={() => setSelectedTrade(trade)}
                    className="cursor-pointer border-t border-white/10 hover:bg-white/5"
                  >
                    <td className="px-4 py-3 text-cream/80">{trade.date}</td>
                    <td className="px-4 py-3 font-medium text-cream">{trade.asset}</td>
                    <td className="px-4 py-3 text-cream/70">
                      {trade.side === 'long' ? 'Long' : 'Short'}
                    </td>
                    <td className="px-4 py-3 text-cream/70">{trade.setup || '—'}</td>
                    <td className="px-4 py-3 text-cream/70">{trade.session}</td>
                    <td
                      className={`px-4 py-3 text-right font-semibold tabular-nums ${
                        pnl >= 0 ? 'text-success' : 'text-danger'
                      }`}
                    >
                      {pnl >= 0 ? '+' : ''}
                      {pnl.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showNewTrade && (
        <Modal title="Nouveau trade" onClose={() => setShowNewTrade(false)}>
          <TradeForm
            onSaved={() => {
              refreshTrades();
              setShowNewTrade(false);
            }}
          />
        </Modal>
      )}

      {showMissed && (
        <Modal title="Trades non pris" onClose={() => setShowMissed(false)}>
          <MissedTradesList
            missedTrades={missedTrades}
            onChanged={refreshMissedTrades}
          />
        </Modal>
      )}

      {selectedTrade && (
        <Modal
          title="Détail du trade"
          onClose={() => setSelectedTrade(null)}
        >
          <TradeDetail trade={selectedTrade} />
        </Modal>
      )}
    </div>
  );
}
