import type { SegmentPerf } from '../lib/analytics';

export function HeatmapStrip({ cells }: { cells: SegmentPerf[] }) {
  const maxAbs = Math.max(1, ...cells.map((c) => Math.abs(c.pnl)));

  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {cells.map((cell) => {
        const intensity = cell.count === 0 ? 0 : Math.abs(cell.pnl) / maxAbs;
        const background =
          cell.count === 0
            ? 'rgba(240,237,228,0.05)'
            : cell.pnl >= 0
              ? `rgba(111,168,138,${(0.15 + intensity * 0.7).toFixed(2)})`
              : `rgba(217,102,89,${(0.15 + intensity * 0.7).toFixed(2)})`;

        return (
          <div
            key={cell.label}
            title={`${cell.label} — ${cell.count} trade(s), ${cell.pnl.toFixed(2)} €`}
            className="flex min-w-[2.25rem] flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[10px] text-cream/70"
            style={{ background }}
          >
            <span>{cell.label}</span>
          </div>
        );
      })}
    </div>
  );
}
