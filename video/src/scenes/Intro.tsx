import { AbsoluteFill } from 'remotion'
import { Aurora } from '../fx/Aurora'
import { Bloom } from '../fx/Bloom'
import { Shake } from '../fx/Shake'
import { expoOut, sineInOut } from '../lib/ease'
import { noise1 } from '../lib/random'
import { keys, prog, spring, useLayout, useLocalBeat } from '../lib/time'
import { ecgAt, pathOf } from '../ui/ecg'
import { PulseLine } from '../ui/PulseLine'
import { MaskText } from '../ui/Text'
import { C } from '../theme'
import { INTRO, INTRO_HEARTBEATS } from '../timeline'

const SPIKES = INTRO_HEARTBEATS.filter((h) => h > INTRO.lineStart)

/** Temps 0–8 : un point lumineux, un battement, la ligne de pouls. « Chaque trade a un pouls. » */
export function Intro() {
  const b = useLocalBeat()
  const { W, H, vertical } = useLayout()
  const x0 = vertical ? 152 : 640
  const y0 = vertical ? 840 : 488
  const speed = vertical ? 196 : 288 // px par temps
  const amp = vertical ? 200 : 232

  // Point lumineux : s'allume, respire, s'embrase au premier battement.
  const on = prog(b, INTRO.dotOn, 1.2, expoOut)
  const breathe = 1 + 0.08 * Math.sin(b * Math.PI * 1.2)
  const flare = b >= 2 ? Math.exp(-(b - 2) * 2.4) : 0
  const headSize = 0.85 * on * breathe + 1.6 * flare
  const wave = prog(b, 2, 1.6, expoOut)

  // Trace d'ECG : un point tous les 1/100 de temps, de la ligne de départ à la tête.
  const pts: [number, number][] = []
  const end = Math.max(INTRO.lineStart, b)
  const jitter = (t: number) => (t > INTRO.shakeStart ? (t - INTRO.shakeStart) * 1.4 : 0)
  for (let t = INTRO.lineStart; t <= end + 1e-6; t += 0.01) {
    const j = jitter(t)
    const y = y0 - amp * ecgAt(t, SPIKES) + noise1(t * 46, 3) * 60 * j + noise1(t * 13, 4) * 30 * j
    pts.push([x0 + (t - INTRO.lineStart) * speed, y])
  }
  const head = pts.length ? pts[pts.length - 1] : ([x0, y0] as [number, number])
  const drawing = b >= INTRO.lineStart

  // Battement : petit sursaut d'exposition à chaque pic.
  const beatPulse = SPIKES.reduce((m, s) => Math.max(m, b >= s ? Math.exp(-(b - s) * 6) : 0), 0)

  // Caméra : lent travelling avant vers le point, puis tremblement avant le chaos.
  const dolly = 1 + 0.06 * sineInOut(Math.min(1, b / 8))
  const shake = keys(b, [[INTRO.shakeStart, 0], [8, 10]])

  return (
    <AbsoluteFill>
      <Aurora intensity={keys(b, [[0, 0], [2, 0.05], [2.2, 0.32], [3.5, 0.14], [8, 0.3]], sineInOut) + 0.08 * beatPulse} />
      <Shake amount={shake}>
        <Bloom amount={0.35 + 0.6 * flare + 0.3 * beatPulse} radius={22}>
          <AbsoluteFill style={{ transform: `scale(${dolly})`, transformOrigin: `${(head[0] / W) * 100}% ${(y0 / H) * 100}%` }}>
            {/* Onde de choc du premier battement. */}
            {b >= 2 && b < 4 && (
              <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
                <circle cx={x0} cy={y0} r={wave * 360} fill="none" stroke="#8B7FE8" strokeWidth={2 + 6 * (1 - wave)} opacity={0.55 * (1 - wave)} />
                <circle cx={x0} cy={y0} r={wave * 220} fill="none" stroke="#A79DF2" strokeWidth={1} opacity={0.4 * (1 - wave)} />
              </svg>
            )}
            {drawing && pts.length > 1 && (
              <PulseLine d={pathOf(pts)} width={3} glow={1 + beatPulse} head={null} fade={{ x: head[0], len: vertical ? 760 : 1100 }} gradX={[x0, x0 + 4 * speed]} viewW={W} viewH={H} />
            )}
            {on > 0 && (
              <PulseLine d="" head={drawing ? head : [x0, y0]} headSize={drawing ? 0.9 + 0.8 * beatPulse : headSize} glow={0} viewW={W} viewH={H} />
            )}
          </AbsoluteFill>
        </Bloom>
        <MaskText
          text={vertical ? ['Chaque trade', 'a un pouls.'] : 'Chaque trade a un pouls.'}
          b={b}
          at={INTRO.textStart}
          stagger={0.14}
          dur={1}
          align="center"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: vertical ? 1184 : 744,
            fontSize: vertical ? 88 : 72,
            fontWeight: 600,
            letterSpacing: '-0.025em',
            lineHeight: 1.08,
            color: C.tx,
            opacity: 1 - prog(b, 7.6, 0.4) * 0.6,
          }}
        />
        {/* Légère montée sous le texte : un filet qui s'élargit. */}
        <div
          style={{
            position: 'absolute',
            left: W / 2 - 120 * spring(b, INTRO.textStart + 0.6),
            width: 240 * spring(b, INTRO.textStart + 0.6),
            top: vertical ? 1416 : 848,
            height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(167,157,242,.7), transparent)',
          }}
        />
      </Shake>
    </AbsoluteFill>
  )
}
