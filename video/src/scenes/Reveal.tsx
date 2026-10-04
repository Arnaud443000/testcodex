import { AbsoluteFill } from 'remotion'
import { Aurora } from '../fx/Aurora'
import { Bloom } from '../fx/Bloom'
import { clamp01, expoOut, quintInOut, sineInOut } from '../lib/ease'
import { mix, prog, spring, useLayout, useLocalBeat } from '../lib/time'
import { ecgShape, pathOf, smoothPath } from '../ui/ecg'
import { LOGO_BARS, Logo } from '../ui/Logo'
import { PulseLine } from '../ui/PulseLine'
import { equityAt } from '../ui/series'
import { MaskText } from '../ui/Text'
import { C } from '../theme'
import { REVEAL, SCENES } from '../timeline'

const S = SCENES.reveal[0]
const L = {
  curve: REVEAL.curveStart - S,
  logo: REVEAL.logoStart - S,
  word: REVEAL.wordmark - S,
  tag: REVEAL.tagline - S,
}

/** Temps 20–25 : un battement dans le noir ; la ligne devient courbe d'équité, puis le logo. */
export function Reveal() {
  const b = useLocalBeat()
  const { W, H, vertical } = useLayout()

  // Lockup final (logo, mot-symbole, signature).
  const logoSize = vertical ? 248 : 208
  const cx = W / 2
  const cy = vertical ? 744 : 392
  const sc = logoSize / 104

  // 1. Ligne plate + un pic au centre, puis morphing vers la courbe d'équité.
  const yFlat = cy + (vertical ? 120 : 96)
  const xa = vertical ? 96 : 240
  const xb = W - xa
  const morph = quintInOut(prog(b, L.curve, 1.5))
  const spike = b >= 0 ? Math.exp(-b * 3.2) : 0
  const N = 160
  const pts: [number, number][] = []
  const hgt = vertical ? 420 : 380
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const xFlat = t * W
    const xEq = xa + (xb - xa) * t
    const u = (t - 0.5) * 3 // temps autour du pic central
    const yE = yFlat - 240 * spike * ecgShape(u)
    const yQ = yFlat + hgt * 0.45 - equityAt(t) * hgt
    pts.push([mix(xFlat, xEq, morph), mix(yE, yQ, morph)])
  }
  const curveFade = 1 - prog(b, L.logo + 0.1, 0.7, sineInOut)
  const lineOn = prog(b, 0, 0.15)

  // 2. Les points de la courbe deviennent les barres du logo (ressort, du centre vers l'extérieur).
  const bars = (bar: (typeof LOGO_BARS)[number]) => {
    const t = (bar.col + 6) / 12
    const sx = mix(xa, xb, t)
    const sy = yFlat + hgt * 0.45 - equityAt(t) * hgt
    const delay = L.logo + Math.abs(bar.col) * 0.045
    const p = spring(b, delay, { freq: 1.7, damping: 0.62 })
    const fx = cx + (bar.x + 3) * sc
    const fy = cy + (bar.y + bar.h / 2) * sc
    return {
      dx: ((sx - fx) / sc) * (1 - clamp01(p)),
      dy: ((sy - fy) / sc) * (1 - p),
      sy: Math.max(0.04, p),
      o: clamp01((b - delay) * 6),
    }
  }
  const settle = L.logo + 0.75
  const flash = b >= settle ? Math.exp(-(b - settle) * 2.6) : 0
  const logoGlow = 0.55 + 0.9 * flash

  // Caméra : léger travelling avant, puis défocalisation sur la montée vers le plan suivant.
  const push = 1 + 0.035 * sineInOut(clamp01(b / 5))
  const defocus = prog(b, 4.72, 0.28, expoOut) * 4

  return (
    <AbsoluteFill>
      <Aurora intensity={0.06 + 0.84 * prog(b, L.logo, 1.6, sineInOut)} />
      <Bloom amount={0.25 + 0.75 * flash + 0.3 * spike} radius={26}>
        <AbsoluteFill style={{ transform: `scale(${push})`, filter: defocus > 0.2 ? `blur(${defocus}px)` : undefined }}>
          {curveFade > 0 && (
            <>
              {/* Remplissage de la courbe d'équité (comme dans l'app). */}
              <svg width={W} height={H} style={{ position: 'absolute', inset: 0, opacity: morph * curveFade * 0.9 }}>
                <defs>
                  <linearGradient id="rv-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#8B7FE8" stopOpacity=".32" />
                    <stop offset="1" stopColor="#4A5FD9" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={`${smoothPath(pts)}L${pts[N][0]} ${yFlat + hgt * 0.5}L${pts[0][0]} ${yFlat + hgt * 0.5}Z`} fill="url(#rv-fill)" />
                {[0.25, 0.5, 0.75].map((f) => (
                  <line key={f} x1={xa} x2={xb} y1={yFlat + hgt * 0.45 - hgt * f} y2={yFlat + hgt * 0.45 - hgt * f} stroke="rgba(255,255,255,.05)" />
                ))}
              </svg>
              <PulseLine
                d={morph > 0.02 ? smoothPath(pts) : pathOf(pts)}
                width={3}
                glow={1 + spike}
                opacity={lineOn * curveFade * (0.45 + 0.55 * Math.max(spike, morph))}
                head={morph > 0.6 ? pts[N] : null}
                headSize={1.1}
                gradX={[xa, xb]}
                viewW={W}
                viewH={H}
              />
            </>
          )}
          {b >= L.logo && (
            <div style={{ position: 'absolute', left: cx - logoSize / 2, top: cy - logoSize / 2 }}>
              <Logo size={logoSize} glow={logoGlow} bar={(bar) => bars(bar)} />
            </div>
          )}
        </AbsoluteFill>
      </Bloom>
      <MaskText
        text="Pulse"
        b={b}
        at={L.word}
        dur={1.1}
        align="center"
        style={{ position: 'absolute', left: 0, right: 0, top: cy + logoSize / 2 + (vertical ? 40 : 24), fontSize: vertical ? 152 : 128, fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1, filter: defocus > 0.2 ? `blur(${defocus}px)` : undefined }}
      />
      <MaskText
        text={vertical ? ['Ton journal de trading,', 'enfin lucide.'] : 'Ton journal de trading, enfin lucide.'}
        b={b}
        at={L.tag}
        stagger={0.05}
        dur={0.9}
        align="center"
        style={{ position: 'absolute', left: 0, right: 0, top: cy + logoSize / 2 + (vertical ? 232 : 184), fontSize: vertical ? 56 : 44, fontWeight: 500, letterSpacing: '-0.01em', lineHeight: 1.2, color: C.tx2, filter: defocus > 0.2 ? `blur(${defocus}px)` : undefined }}
      />
    </AbsoluteFill>
  )
}
