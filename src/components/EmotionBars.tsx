import type { EmotionPerf } from '../lib/behavior';
import { formatCurrency } from '../lib/format';

export function EmotionBars({ data }: { data: EmotionPerf[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-cream/40">Pas encore de données.</p>;
  }

  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.pnl)));

  return (
    <div className="flex flex-col gap-3">
      {data.map((row) => {
        const width = (Math.abs(row.pnl) / maxAbs) * 50;
        const positive = row.pnl >= 0;
        return (
          <div key={row.emotion} className="flex items-center gap-3 text-sm">
            <span className="w-32 shrink-0 truncate text-cream/80" title={row.emotion}>
              {row.emotion}
            </span>
            <div className="relative h-6 flex-1 rounded-md bg-background/60">
              <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
              <div
                className={`absolute inset-y-1 rounded ${
                  positive ? 'bg-success/70' : 'bg-danger/70'
                }`}
                style={
                  positive
                    ? { left: '50%', width: `${width}%` }
                    : { right: '50%', width: `${width}%` }
                }
              />
            </div>
            <span
              className={`w-24 shrink-0 text-right font-semibold tabular-nums ${
                positive ? 'text-success' : 'text-danger'
              }`}
            >
              {formatCurrency(row.pnl)}
            </span>
            <span className="w-24 shrink-0 text-right text-xs text-cream/50">
              {row.count} · {row.winRate.toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
