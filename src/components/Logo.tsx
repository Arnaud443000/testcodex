import { useId } from 'react'

/** Equalizer-bars diamond around a circular void (charte 1). Working version, to be replaced by the official SVG. */
export function Logo({ size = 38 }: { size?: number }) {
  const id = useId()
  const W = 8
  const bars: { x: number; y: number; h: number }[] = []
  for (let i = -6; i <= 6; i++) {
    const x = i * W
    const H = 100 * (1 - Math.abs(i) / 7.4)
    const cut = Math.abs(x) < 17 ? Math.sqrt(Math.max(0, 17 * 17 - x * x)) : 0
    const segs: [number, number][] = cut > 0 ? [[-H / 2, -cut], [cut, H / 2]] : [[-H / 2, H / 2]]
    for (const [a, b] of segs) if (b - a > 3) bars.push({ x: x - 3, y: a, h: b - a })
  }
  const shapes = bars.map((b, i) => <rect key={i} x={b.x} y={b.y} width={6} height={b.h} rx={3} />)
  return (
    <svg width={size} height={size} viewBox="-52 -52 104 104" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#4A5FD9" />
          <stop offset="1" stopColor="#8B7FE8" />
        </linearGradient>
        <filter id={`${id}-g`}>
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <g fill={`url(#${id})`} filter={`url(#${id}-g)`} opacity=".55">{shapes}</g>
      <g fill={`url(#${id})`}>{shapes}</g>
    </svg>
  )
}
