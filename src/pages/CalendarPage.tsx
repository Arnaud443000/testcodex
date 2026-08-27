import { useMemo, useState } from 'react';
import type { Trade } from '../types/trade';
import { useAccountTrades } from '../lib/accountContext';
import { computeTradePnl } from '../lib/pnl';
import { formatCurrency } from '../lib/format';
import { Modal } from '../components/Modal';

const MONTH_LABEL = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function toKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Sunday-first getDay() -> Monday-first grid column. */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export function CalendarPage() {
  const trades = useAccountTrades();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const pnlByDay = useMemo(() => {
    const map = new Map<string, { pnl: number; trades: Trade[] }>();
    for (const trade of trades) {
      if (!trade.closed) continue;
      const existing = map.get(trade.date);
      const pnl = computeTradePnl(trade);
      if (existing) {
        existing.pnl += pnl;
        existing.trades.push(trade);
      } else {
        map.set(trade.date, { pnl, trades: [trade] });
      }
    }
    return map;
  }, [trades]);

  const maxAbsPnl = Math.max(1, ...Array.from(pnlByDay.values()).map((d) => Math.abs(d.pnl)));

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = mondayIndex(firstOfMonth);

  const cells: (Date | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];

  const monthTotal = Array.from(pnlByDay.entries())
    .filter(([key]) => key.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`))
    .reduce((sum, [, v]) => sum + v.pnl, 0);

  const selected = selectedDay ? pnlByDay.get(selectedDay) : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-cream">Pulse — Calendrier</h1>
          <p
            className={`text-sm ${monthTotal >= 0 ? 'text-success' : 'text-danger'}`}
          >
            Total du mois : {formatCurrency(monthTotal)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setCursor(new Date(year, month - 1, 1))}
            className="rounded-full bg-surface px-3 py-1.5 text-sm text-cream/70 hover:text-cream"
          >
            ←
          </button>
          <span className="w-40 text-center text-sm font-medium capitalize text-cream">
            {MONTH_LABEL.format(cursor)}
          </span>
          <button
            type="button"
            onClick={() => setCursor(new Date(year, month + 1, 1))}
            className="rounded-full bg-surface px-3 py-1.5 text-sm text-cream/70 hover:text-cream"
          >
            →
          </button>
        </div>
      </header>

      {pnlByDay.size === 0 && (
        <p className="rounded-2xl border border-white/10 bg-surface/40 px-4 py-6 text-center text-sm text-cream/50">
          Aucun trade enregistré. Ajoute un trade pour voir apparaître ton calendrier de
          performance.
        </p>
      )}

      <div className="grid grid-cols-7 gap-2">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="text-center text-xs uppercase tracking-wide text-cream/40">
            {label}
          </div>
        ))}

        {cells.map((date, index) => {
          if (!date) return <div key={`blank-${index}`} />;
          const key = toKey(date);
          const day = pnlByDay.get(key);
          const intensity = day ? Math.min(1, Math.abs(day.pnl) / maxAbsPnl) : 0;
          const background = !day
            ? 'rgba(240,237,228,0.04)'
            : day.pnl >= 0
              ? `rgba(111,168,138,${(0.15 + intensity * 0.7).toFixed(2)})`
              : `rgba(217,102,89,${(0.15 + intensity * 0.7).toFixed(2)})`;

          return (
            <button
              key={key}
              type="button"
              disabled={!day}
              onClick={() => setSelectedDay(key)}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl text-xs transition disabled:cursor-default"
              style={{ background }}
            >
              <span className="text-cream/60">{date.getDate()}</span>
              {day && (
                <span
                  className={`font-semibold tabular-nums ${
                    day.pnl >= 0 ? 'text-success' : 'text-danger'
                  }`}
                >
                  {day.pnl >= 0 ? '+' : ''}
                  {day.pnl.toFixed(0)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selected && selectedDay && (
        <Modal title={`Trades du ${selectedDay}`} onClose={() => setSelectedDay(null)}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-cream/50">
                <th className="pb-2 pr-4">Actif</th>
                <th className="pb-2 pr-4">Sens</th>
                <th className="pb-2 pr-4">Setup</th>
                <th className="pb-2 text-right">PnL</th>
              </tr>
            </thead>
            <tbody>
              {selected.trades.map((trade) => {
                const pnl = computeTradePnl(trade);
                return (
                  <tr key={trade.id} className="border-t border-white/10">
                    <td className="py-2 pr-4 font-medium text-cream">{trade.asset}</td>
                    <td className="py-2 pr-4 text-cream/70">
                      {trade.side === 'long' ? 'Long' : 'Short'}
                    </td>
                    <td className="py-2 pr-4 text-cream/70">{trade.setup || '—'}</td>
                    <td
                      className={`py-2 text-right font-semibold tabular-nums ${
                        pnl >= 0 ? 'text-success' : 'text-danger'
                      }`}
                    >
                      {formatCurrency(pnl)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}
