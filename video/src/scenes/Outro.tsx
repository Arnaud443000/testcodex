import type { ReactNode } from 'react'
import { AbsoluteFill } from 'remotion'
import { Aurora } from '../fx/Aurora'
import { Bloom } from '../fx/Bloom'
import { Flare, Halo } from '../fx/Flare'
import { clamp01, expoOut, quintOut, sineInOut } from '../lib/ease'
import { mix, prog, useLayout, useLocalBeat } from '../lib/time'
import { Logo } from '../ui/Logo'
import { MaskText } from '../ui/Text'
import { C } from '../theme'
import { OUTRO, SCENES } from '../timeline'
import { CARDS, HEAT_H, HEAT_W, HeatmapCard } from './cards'

const S = SCENES.outro[0]
const L = { title: OUTRO.title - S, beat: OUTRO.lastBeat - S, slogan: OUTRO.slogan.map((s) => s - S), fade: OUTRO.fadeOut - S }
const PERSP = 1600

type Node = { key: string; x: number; y: number; z: number; w: number; h: number; render: () => ReactNode }
const card = (id: keyof typeof CARDS) => {
  const C2 = CARDS[id].Card
  return () => <C2 b={20} />
}

/** Temps 68–75 : la caméra recule, les écrans en constellation autour du logo, dernier battement. */
export function Outro() {
  const b = useLocalBeat()
  const { W, H, vertical } = useLayout()
  const k = vertical ? 0.62 : 1
  const nodes: Node[] = [
    { key: 'f1', x: -700 * k, y: (vertical ? -700 : -300), z: -220, w: 880, h: 600, render: card('f1') },
    { key: 'f2', x: 720 * k, y: (vertical ? -620 : -290), z: -380, w: 880, h: 600, render: card('f2') },
    { key: 'f3', x: -760 * k, y: (vertical ? 640 : 300), z: -440, w: 880, h: 600, render: card('f3') },
    { key: 'f6', x: 760 * k, y: (vertical ? 700 : 320), z: -260, w: 880, h: 600, render: card('f6') },
    { key: 'f5', x: -1260 * k, y: vertical ? -40 : -10, z: -980, w: 880, h: 600, render: card('f5') },
    { key: 'f4', x: 1240 * k, y: vertical ? 40 : 10, z: -1000, w: 700, h: 440, render: card('f4') },
    { key: 'heat', x: 120 * k, y: vertical ? -980 : -560, z: -1300, w: HEAT_W, h: HEAT_H, render: () => <HeatmapCard b={20} /> },
  ]

  // Caméra : part très près du logo et recule (quintOut), avec une orbite lente.
  const pull = quintOut(prog(b, 0, 4.4))
  const camZ = mix(820, 0, pull) - 60 * sineInOut(prog(b, 4.4, 2.6))
  const ry = ((mix(14, -5, sineInOut(clamp01(b / 7))) * Math.PI) / 180) as number
  const cx = W / 2
  const logoY = vertical ? -220 : -150
  const cy = H / 2

  const project = (x: number, y: number, z: number) => {
    const xr = x * Math.cos(ry) - z * Math.sin(ry)
    const zr = x * Math.sin(ry) + z * Math.cos(ry)
    const depth = PERSP - (zr + camZ)
    const s = PERSP / Math.max(80, depth)
    return { sx: cx + xr * s, sy: cy + y * s, s, zr }
  }

  // Dernier battement : pulsation du logo, éclair, onde, lumière qui part vers chaque écran.
  const hit = b >= L.beat ? Math.exp(-(b - L.beat) * 3.2) : 0
  const pulse = 1 + 0.12 * (b >= L.beat ? Math.sin(Math.min(Math.PI, (b - L.beat) * 6)) * Math.exp(-(b - L.beat) * 2) : 0) + 0.04 * Math.exp(-((b - 2) ** 2) * 20)
  const wave = prog(b, L.beat, 1.8, expoOut)
  const travel = prog(b, L.beat, 0.9, expoOut)
  const fade = prog(b, L.fade, S + 7 - OUTRO.fadeOut)

  const logo = project(0, logoY, 0)
  const logoSize = 184 * logo.s * pulse
  const sorted = [...nodes].map((n) => ({ n, p: project(n.x, n.y, n.z) })).sort((a, c) => a.p.zr - c.p.zr)
  const textTop = vertical ? cy + 40 : cy + 30

  return (
    <AbsoluteFill>
      <Aurora intensity={0.85 + 0.15 * hit} />
      <Halo x={logo.sx} y={logo.sy} r={logoSize * 2} k={0.7 + 0.5 * hit} />
      <Bloom amount={0.3 + 1.1 * hit} radius={30}>
        <AbsoluteFill>
          {/* Fils lumineux entre le logo et chaque écran. */}
          <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
            <defs>
              <radialGradient id="ot-dot">
                <stop offset="0" stopColor="#fff" />
                <stop offset="1" stopColor="#8B7FE8" stopOpacity="0" />
              </radialGradient>
            </defs>
            {sorted.map(({ n, p }, i) => {
              const o = prog(b, 0.8 + i * 0.12, 1.2)
              const tx = mix(logo.sx, p.sx, travel)
              const ty = mix(logo.sy, p.sy, travel)
              return (
                <g key={n.key}>
                  <line x1={logo.sx} y1={logo.sy} x2={mix(logo.sx, p.sx, o)} y2={mix(logo.sy, p.sy, o)} stroke="#8B7FE8" strokeOpacity={0.22 + 0.4 * hit} strokeWidth={1.2} />
                  {b >= L.beat && travel < 1 && <circle cx={tx} cy={ty} r={14} fill="url(#ot-dot)" />}
                </g>
              )
            })}
            {b >= L.beat && b < L.beat + 2 && <circle cx={logo.sx} cy={logo.sy} r={wave * 760} fill="none" stroke="#A79DF2" strokeWidth={2 + 4 * (1 - wave)} opacity={0.6 * (1 - wave)} />}
          </svg>
          {sorted.map(({ n, p }, i) => {
            const sc = 0.4 * p.s
            const dof = Math.min(9, Math.abs(p.zr) * 0.008)
            const appear = prog(b, 0.2 + i * 0.1, 1.2, expoOut)
            return (
              <div
                key={n.key}
                style={{
                  position: 'absolute',
                  left: p.sx - n.w / 2,
                  top: p.sy - n.h / 2,
                  width: n.w,
                  height: n.h,
                  transform: `scale(${sc}) perspective(1600px) rotateY(${clamp01(Math.abs(n.x) / 1200) * -Math.sign(n.x) * 16}deg)`,
                  opacity: appear * (0.55 + 0.45 * clamp01(1 + p.zr / 1400)) * (0.85 + 0.15 * hit),
                  filter: `blur(${dof.toFixed(2)}px) brightness(${1 + 0.35 * hit})`,
                }}
              >
                {n.render()}
              </div>
            )
          })}
          <div style={{ position: 'absolute', left: logo.sx - logoSize / 2, top: logo.sy - logoSize / 2 }}>
            <Logo size={logoSize} glow={0.6 + 0.9 * hit} />
          </div>
        </AbsoluteFill>
      </Bloom>
      <Flare x={logo.sx} y={logo.sy} k={hit} width={vertical ? 1000 : 1600} />
      {/* Voile derrière le texte pour garder un seul point focal. */}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse ${vertical ? '60% 22%' : '42% 34%'} at 50% ${((textTop + 60) / H) * 100}%, rgba(6,8,24,.78), transparent 70%)`, opacity: prog(b, L.title - 0.5, 1) }} />
      <MaskText
        text={vertical ? ['Pulse —', 'Trade avec méthode.'] : 'Pulse — Trade avec méthode.'}
        b={b}
        at={L.title}
        stagger={0.07}
        align="center"
        style={{ position: 'absolute', left: 0, right: 0, top: textTop, fontSize: vertical ? 80 : 68, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.08 }}
      />
      <div style={{ position: 'absolute', left: 0, right: 0, top: textTop + (vertical ? 200 : 100), display: 'flex', justifyContent: 'center', gap: vertical ? 20 : 24 }}>
        {['Clarté.', 'Discipline.', 'Performance.'].map((w, i) => (
          <MaskText key={w} text={w} b={b} at={L.slogan[i]} dur={0.7} style={{ fontSize: vertical ? 44 : 36, fontWeight: 500, letterSpacing: '0.01em', color: i === 1 ? C.txAccent : C.tx2 }} />
        ))}
      </div>
      <AbsoluteFill style={{ background: '#000', opacity: fade }} />
      <AbsoluteFill style={{ background: '#fff', opacity: 0.12 * hit, mixBlendMode: 'screen' }} />
    </AbsoluteFill>
  )
}

