import { useId } from 'react'

/**
 * La ligne lumineuse du film : halo large flouté (bloom), trait en dégradé de marque et
 * cœur presque blanc. `fade` = longueur (px) de la traînée de phosphore derrière la tête.
 */
export function PulseLine({
  d,
  width = 3,
  glow = 1,
  head,
  headSize = 1,
  fade,
  colors = ['#4A5FD9', '#8B7FE8'],
  opacity = 1,
  gradX = [0, 1920],
  core = 0.85,
  viewW = 1920,
  viewH = 1080,
  draw,
}: {
  d: string
  width?: number
  glow?: number
  head?: [number, number] | null
  headSize?: number
  fade?: { x: number; len: number; dir?: 1 | -1 }
  colors?: [string, string]
  opacity?: number
  gradX?: [number, number]
  core?: number
  viewW?: number
  viewH?: number
  /** Tracé progressif (0 → 1) le long du chemin. */
  draw?: number
}) {
  const id = useId().replace(/:/g, '')
  const mask = fade ? `url(#m${id})` : undefined
  const dir = fade?.dir ?? 1
  const dash = draw === undefined ? {} : { pathLength: 1, strokeDasharray: `${Math.max(0, draw)} 2` }
  return (
    <svg width={viewW} height={viewH} viewBox={`0 0 ${viewW} ${viewH}`} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', opacity }}>
      <defs>
        <linearGradient id={`g${id}`} gradientUnits="userSpaceOnUse" x1={gradX[0]} y1="0" x2={gradX[1]} y2="0">
          <stop offset="0" stopColor={colors[0]} />
          <stop offset="1" stopColor={colors[1]} />
        </linearGradient>
        <filter id={`b${id}`} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation={6 + 6 * glow} />
        </filter>
        <filter id={`s${id}`} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation={2.2} />
        </filter>
        <radialGradient id={`h${id}`}>
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.25" stopColor="#C9C2FF" stopOpacity=".9" />
          <stop offset="1" stopColor="#8B7FE8" stopOpacity="0" />
        </radialGradient>
        {fade && (
          <>
            <linearGradient id={`f${id}`} gradientUnits="userSpaceOnUse" x1={fade.x - dir * fade.len} y1="0" x2={fade.x} y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.55" stopColor="#fff" stopOpacity=".55" />
              <stop offset="1" stopColor="#fff" stopOpacity="1" />
            </linearGradient>
            <mask id={`m${id}`} maskUnits="userSpaceOnUse" x={-200} y={-200} width={viewW + 400} height={viewH + 400}>
              <rect x={-200} y={-200} width={viewW + 400} height={viewH + 400} fill={`url(#f${id})`} />
            </mask>
          </>
        )}
      </defs>
      <g mask={mask}>
        {glow > 0 && <path d={d} {...dash} fill="none" stroke={`url(#g${id})`} strokeWidth={width * 5} strokeLinecap="round" strokeLinejoin="round" filter={`url(#b${id})`} opacity={0.75 * Math.min(glow, 1.5)} />}
        <path d={d} {...dash} fill="none" stroke={`url(#g${id})`} strokeWidth={width * 1.8} strokeLinecap="round" strokeLinejoin="round" filter={`url(#s${id})`} opacity={0.9} />
        <path d={d} {...dash} fill="none" stroke={`url(#g${id})`} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
        {core > 0 && <path d={d} {...dash} fill="none" stroke="#EDEBFF" strokeWidth={Math.max(0.8, width * 0.32)} strokeLinecap="round" strokeLinejoin="round" opacity={core} />}
      </g>
      {head && (
        <g transform={`translate(${head[0]} ${head[1]})`}>
          <circle r={34 * headSize} fill={`url(#h${id})`} opacity={0.55} />
          <circle r={12 * headSize} fill={`url(#h${id})`} />
          <circle r={3.2 * headSize} fill="#fff" />
        </g>
      )}
    </svg>
  )
}
