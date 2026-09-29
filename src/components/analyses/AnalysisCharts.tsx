import { formatDate } from '../../lib/format'
import type { CurvePoint } from '../charts'

/** Tracé seulement : les valeurs viennent de pulse-core (charte 6, courbe d'équité). */

export interface Series {
  id: string
  label: string
  /** Couleur de la palette catégorielle (charte 2.4). */
  color: string
  points: CurvePoint[]
}

/** Palette catégorielle de la charte (2.4) ; le gris est réservé au groupe « sans stratégie ». */
export const SERIES_COLORS = ['#4A5FD9', '#8B7FE8', '#5FCB9E', '#D9A85A', '#4FB8C9', '#C98BB0']
export const NEUTRAL_SERIES = '#B9BECF'

const W = 1000
const H = 236
const PAD_X = 12
const PAD_TOP = 24
const PAD_BOTTOM = 34

/**
 * Courbes cumulées superposées, sur une échelle de temps commune. Chaque courbe part de zéro : elle reste à plat
 * jusqu'à son premier trade. Trois repères sur l'axe vertical (haut, zéro, bas), cinq dates en bas.
 */
export function MultiLineChart({
  series,
  label,
  format,
  fill = false,
  fromZero = true,
}: {
  series: Series[]
  label: string
  format: (value: number) => string
  fill?: boolean
  /** Faux pour une série qui n'est pas cumulée (solde, risque) : elle ne part pas de zéro. */
  fromZero?: boolean
}) {
  const all = series.flatMap((s) => s.points)
  if (all.length === 0) return null
  const t0 = Math.min(...all.map((p) => p.time))
  const t1 = Math.max(...all.map((p) => p.time))
  const tSpan = t1 - t0 || 1
  const values = fromZero ? [0, ...all.map((p) => p.value)] : all.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const x = (t: number) => PAD_X + ((t - t0) / tSpan) * (W - 2 * PAD_X)
  const y = (v: number) => PAD_TOP + (1 - (v - min) / span) * (H - PAD_TOP - PAD_BOTTOM)
  const zeroY = y(0)
  /** Ligne de base du remplissage : le zéro d'une courbe cumulée, le bas du graphique sinon. */
  const baseY = fromZero ? zeroY : H - PAD_BOTTOM
  const zeroVisible = min <= 0 && max >= 0
  const grid = [0, 1, 2, 3, 4].map((i) => PAD_TOP + (i * (H - PAD_TOP - PAD_BOTTOM)) / 4)
  const dates = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + f * tSpan)
  const marks = [
    { v: max, top: y(max) },
    ...(fromZero && min < 0 && max > 0 ? [{ v: 0, top: zeroY }] : []),
    ...(min < 0 || (!fromZero && min !== max) ? [{ v: min, top: y(min) }] : []),
  ]
  return (
    <div className="relative" role="img" aria-label={label}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          {series.map((s) => (
            <linearGradient key={s.id} id={`ml-fill-${s.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={s.color} stopOpacity="0.28" />
              <stop offset="1" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {grid.map((g) => (
          <line key={g} x1={PAD_X} x2={W - PAD_X} y1={g} y2={g} stroke="rgba(255,255,255,.05)" />
        ))}
        {zeroVisible && <line x1={PAD_X} x2={W - PAD_X} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,.18)" strokeDasharray="4 5" />}
        {series.map((s) => {
          if (s.points.length === 0) return null
          const first = s.points[0]
          const start = fromZero ? [`${x(t0).toFixed(1)},${zeroY.toFixed(1)}`, `${x(first.time).toFixed(1)},${zeroY.toFixed(1)}`] : []
          const coords = [...start, ...s.points.map((p) => `${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`)]
          const line = `M${coords.join(' L')}`
          const last = s.points[s.points.length - 1]
          return (
            <g key={s.id}>
              {fill && <path d={`${line} L${x(last.time).toFixed(1)},${baseY.toFixed(1)} L${x(fromZero ? t0 : first.time).toFixed(1)},${baseY.toFixed(1)} Z`} fill={`url(#ml-fill-${s.id})`} />}
              <path d={line} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </g>
          )
        })}
      </svg>
      {marks.map((m) => (
        <span key={m.v} className="pointer-events-none absolute left-1 -translate-y-1/2 rounded bg-bg/70 px-1 text-[11px] tabular-nums text-tx3" style={{ top: `${(m.top / H) * 100}%` }} aria-hidden="true">
          {m.v === 0 ? '0' : format(m.v)}
        </span>
      ))}
      <div className="flex justify-between px-[1.2%] text-xs text-tx3" aria-hidden="true">
        {dates.map((d, i) => (
          <span key={i}>{formatDate(d)}</span>
        ))}
      </div>
    </div>
  )
}

/** Légende : pastille de la couleur de la courbe, nom, valeur finale. Le texte porte le sens, la couleur ne fait que relier. */
export function Legend({ items }: { items: { id: string; color: string; text: string }[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-tx2">
      {items.map((i) => (
        <li key={i.id} className="flex items-center gap-2 tabular-nums">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: i.color }} aria-hidden="true" />
          {i.text}
        </li>
      ))}
    </ul>
  )
}
