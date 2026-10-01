import { formatRatioPercent } from '../../lib/format'
import type { RiskPoint } from '../../lib/comparisonsView'

const W = 1000
const H = 236
const PAD_X = 46
const PAD_TOP = 18
const PAD_BOTTOM = 18

/**
 * Risque de chaque trade (un point par trade, du plus ancien au plus récent) et ligne de la limite. Un dépassement est un
 * losange plein et un rond creux marque un trade dans la limite : la forme porte le sens, pas seulement la couleur.
 * Tracé seulement : les valeurs viennent de pulse-core.
 */
export function RiskChart({ points, top, limitY, limitLabel, label }: { points: RiskPoint[]; top: number; limitY: number | null; limitLabel: string; label: string }) {
  const x = (f: number) => PAD_X + f * (W - PAD_X - 24)
  const y = (f: number) => H - PAD_BOTTOM - f * (H - PAD_TOP - PAD_BOTTOM)
  const grid = [0, 0.25, 0.5, 0.75, 1]
  return (
    <div className="relative" role="img" aria-label={label}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {grid.map((g) => (
          <line key={g} x1={PAD_X} x2={W - 24} y1={y(g)} y2={y(g)} stroke="rgba(255,255,255,.05)" />
        ))}
        {limitY !== null && <line x1={PAD_X} x2={W - 24} y1={y(limitY)} y2={y(limitY)} stroke="#D9A85A" strokeWidth="1.6" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* Les points sont des éléments HTML positionnés en % : ils gardent leur forme quand le graphique s'étire. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {points.map((p) => (
          <span
            key={p.tradeId}
            className={`absolute block -translate-x-1/2 -translate-y-1/2 ${p.over ? 'h-3 w-3 rotate-45 bg-loss' : 'h-2.5 w-2.5 rounded-full border-2 border-violet bg-transparent'}`}
            style={{ left: `${(x(p.x) / W) * 100}%`, top: `${(y(p.y) / H) * 100}%` }}
          />
        ))}
        {[0, 1].map((g) => (
          <span key={g} className="absolute left-1 -translate-y-1/2 rounded bg-bg/70 px-1 text-[11px] tabular-nums text-tx3" style={{ top: `${(y(g) / H) * 100}%` }}>
            {formatRatioPercent(g * top, 1)}
          </span>
        ))}
        {limitY !== null && (
          <span className="absolute right-2 -translate-y-full rounded bg-bg/70 px-1 text-[11px] tabular-nums text-warn" style={{ top: `${(y(limitY) / H) * 100}%` }}>
            {limitLabel}
          </span>
        )}
      </div>
    </div>
  )
}
