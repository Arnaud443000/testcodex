import { formatDate } from '../lib/format'

/** Petit outil de dessin : tout ce qui est calculé (chiffres, ratios) vient de pulse-core ; ici on ne fait que le tracé. */

export interface CurvePoint {
  time: number
  value: number
}

const W = 1000
const H = 236
const PAD_X = 26
const PAD_TOP = 26
const PAD_BOTTOM = 44

function scale(values: number[]) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return (v: number) => PAD_TOP + (1 - (v - min) / span) * (H - PAD_TOP - PAD_BOTTOM)
}

/** Courbe d'équité (charte 4.3) : trait dégradé bleu → violet, remplissage, grille à 5 %, point final lumineux. */
export function EquityChart({ points, label }: { points: CurvePoint[]; label: string }) {
  // La courbe démarre à 0 : le premier trade est un vrai départ, pas un point isolé.
  const first = points[0]
  const series = first ? [{ time: first.time - 1, value: 0 }, ...points] : []
  const values = series.map((p) => p.value)
  const y = scale([...values, 0])
  const t0 = series[0]?.time ?? 0
  const tSpan = (series[series.length - 1]?.time ?? 1) - t0 || 1
  const x = (t: number) => PAD_X + ((t - t0) / tSpan) * (W - 2 * PAD_X - 40)
  const coords = series.map((p) => `${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`)
  const line = `M${coords.join(' L')}`
  const last = series[series.length - 1]
  const zeroY = y(0)
  const grid = [0, 1, 2, 3, 4].map((i) => PAD_TOP + (i * (H - PAD_TOP - PAD_BOTTOM)) / 4)
  const dotX = last ? x(last.time) : 0
  const dotY = last ? y(last.value) : 0
  const labels = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + f * tSpan)
  return (
    <div className="relative" role="img" aria-label={label}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="eq-stroke" x1="0" x2="1">
            <stop offset="0" stopColor="#4A5FD9" />
            <stop offset="1" stopColor="#8B7FE8" />
          </linearGradient>
          <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8B7FE8" stopOpacity="0.32" />
            <stop offset="1" stopColor="#8B7FE8" stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((g) => (
          <line key={g} x1={PAD_X} x2={W - PAD_X} y1={g} y2={g} stroke="rgba(255,255,255,.05)" />
        ))}
        {series.length > 0 && (
          <>
            <line x1={PAD_X} x2={W - PAD_X} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,.18)" strokeDasharray="4 5" />
            <path d={`${line} L${dotX.toFixed(1)},${H - PAD_BOTTOM} L${x(t0).toFixed(1)},${H - PAD_BOTTOM} Z`} fill="url(#eq-fill)" />
            <path
              d={line}
              fill="none"
              stroke="url(#eq-stroke)"
              strokeWidth="2.4"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              style={{ filter: 'drop-shadow(0 0 8px rgba(139,127,232,.95))' }}
            />
          </>
        )}
      </svg>
      {last && (
        <span
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/60 bg-violet"
          style={{ left: `${(dotX / W) * 100}%`, top: `${(dotY / H) * 100}%`, boxShadow: '0 0 12px rgba(139,127,232,.9)' }}
        />
      )}
      {series.length > 0 && (
        <div className="flex justify-between px-[2.6%] text-xs text-tx3" aria-hidden="true">
          {labels.map((l, i) => (
            <span key={i}>{formatDate(l)}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Sparkline de KPI (charte 4.3) : trait 1,6 px de la couleur sémantique, remplissage léger, ancrée en bas. */
export function Sparkline({ values, tone, id }: { values: (number | null)[]; tone: 'gain' | 'loss' | 'accent'; id: string }) {
  const pts = values.filter((v): v is number => v !== null)
  const color = tone === 'gain' ? '#5FCB9E' : tone === 'loss' ? '#F0776B' : '#8B7FE8'
  const w = 240
  const h = 34
  if (pts.length === 0) return <div className="h-[34px]" />
  const min = Math.min(...pts)
  const span = Math.max(...pts) - min || 1
  const coords = (pts.length === 1 ? [pts[0], pts[0]] : pts).map((v, i, a) => `${((i / (a.length - 1)) * w).toFixed(1)},${(3 + (1 - (v - min) / span) * (h - 6)).toFixed(1)}`)
  const line = `M${coords.join(' L')}`
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" className="block">
      <defs>
        <linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".25" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#sp-${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
