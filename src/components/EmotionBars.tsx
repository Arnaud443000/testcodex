import type { EmotionPerf } from '../lib/behavior';
import { formatCurrency } from '../lib/format';

export function EmotionBars({ data }: { data: EmotionPerf[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-cream/40">Pas encore de données.</p>;
  }

  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.pnl)));

  return (
    <div className="flex flex-col gap-4 sm:gap-3">
      {data.map((row) => {
        const width = (Math.abs(row.pnl) / maxAbs) * 50;
        const positive = row.pnl >= 0;
        return (
          <div key={row.emotion} className="flex flex-col gap-1.5 text-sm sm:flex-row sm:items-center sm:gap-3">
            <div className="flex items-center justify-between gap-3 sm:w-32 sm:shrink-0">
              <span className="truncate text-cream/80" title={row.emotion}>
                {row.emotion}
              </span>
              <span
                className={`font-semibold tabular-nums sm:hidden ${
                  positive ? 'text-success' : 'text-danger'
                }`}
              >
                {formatCurrency(row.pnl)}
              </span>
            </div>
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
              className={`hidden text-right font-semibold tabular-nums sm:inline sm:w-24 sm:shrink-0 ${
                positive ? 'text-success' : 'text-danger'
              }`}
            >
              {formatCurrency(row.pnl)}
            </span>
            <span className="self-end text-xs text-cream/50 sm:w-24 sm:shrink-0 sm:self-auto sm:text-right">
              {row.count} · {row.winRate.toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
