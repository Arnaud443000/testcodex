import { useId } from 'react'

/** Barres du logo (copie exacte de src/components/Logo.tsx de l'app), dans le repère -52..52. */
export type Bar = { x: number; y: number; h: number; col: number }
export const LOGO_BARS: Bar[] = (() => {
  const W = 8
  const bars: Bar[] = []
  for (let i = -6; i <= 6; i++) {
    const x = i * W
    const H = 100 * (1 - Math.abs(i) / 7.4)
    const cut = Math.abs(x) < 17 ? Math.sqrt(Math.max(0, 17 * 17 - x * x)) : 0
    const segs: [number, number][] = cut > 0 ? [[-H / 2, -cut], [cut, H / 2]] : [[-H / 2, H / 2]]
    for (const [a, b] of segs) if (b - a > 3) bars.push({ x: x - 3, y: a, h: b - a, col: i })
  }
  return bars
})()

/**
 * Logo Pulse. `bar(i)` permet d'animer chaque barre (montée en ressort, staggers) ;
 * par défaut, le logo de l'app tel quel. `glow` pilote le halo (0,55 dans l'app).
 */
export function Logo({
  size = 38,
  glow = 0.55,
  bar,
}: {
  size?: number
  glow?: number
  bar?: (b: Bar, i: number) => { sy?: number; dy?: number; dx?: number; o?: number }
}) {
  const id = useId().replace(/:/g, '')
  const shapes = LOGO_BARS.map((b, i) => {
    const a = bar ? bar(b, i) : {}
    const sy = a.sy ?? 1
    const cy = b.y + b.h / 2
    return (
      <rect
        key={i}
        x={b.x + (a.dx ?? 0)}
        y={b.y}
        width={6}
        height={b.h}
        rx={3}
        opacity={a.o ?? 1}
        transform={`translate(0 ${a.dy ?? 0}) translate(0 ${cy}) scale(1 ${Math.max(0.0001, sy)}) translate(0 ${-cy})`}
      />
    )
  })
  return (
    <svg width={size} height={size} viewBox="-52 -52 104 104" style={{ overflow: 'visible', display: 'block' }}>
      <defs>
        <linearGradient id={`lg${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#4A5FD9" />
          <stop offset="1" stopColor="#8B7FE8" />
        </linearGradient>
        <filter id={`lf${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <g fill={`url(#lg${id})`} filter={`url(#lf${id})`} opacity={glow}>
        {shapes}
      </g>
      <g fill={`url(#lg${id})`}>{shapes}</g>
    </svg>
  )
}
