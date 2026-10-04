import { AbsoluteFill } from 'remotion'
import { Aurora } from '../fx/Aurora'
import { Bloom } from '../fx/Bloom'
import { clamp01, expoIn, expoOut, signature } from '../lib/ease'
import { hash } from '../lib/random'
import { mix, prog, spring, useLayout, useLocalBeat } from '../lib/time'
import { Icon } from '../ui/Icon'
import { PulseLine } from '../ui/PulseLine'
import { MaskText } from '../ui/Text'
import { C, R } from '../theme'
import { LOCAL, SCENES } from '../timeline'

const S = SCENES.local[0]
const L = { close: LOCAL.lockClose - S, line1: LOCAL.line1 - S, line2: LOCAL.line2 - S, chips: LOCAL.chips - S }
const PARTICLES = Array.from({ length: 56 }, (_, i) => ({
  r: 250 + hash(i * 3.1) * 190,
  a0: hash(i * 7.7) * Math.PI * 2,
  speed: (0.18 + hash(i * 1.3) * 0.22) * (hash(i) > 0.5 ? 1 : -1),
  size: 1.6 + hash(i * 9.1) * 2.8,
  tilt: 0.28 + hash(i * 4.4) * 0.16,
  warm: hash(i * 2.2) > 0.82,
}))

/** Temps 60–68 : local et privé. La ligne dessine un cadenas qui se ferme. */
export function Local() {
  const b = useLocalBeat()
  const { W, H, vertical } = useLayout()
  const cx = W / 2
  const cy = vertical ? 720 : 400 // centre du corps du cadenas
  const bw = 208
  const bh = 168
  const bx = cx - bw / 2
  const by = cy - bh / 2 + 40
  const r = R.card

  // Trait d'entrée (raccord) puis contour du corps, puis anse.
  const leadHead = mix(-200, bx, expoOut(prog(b, 0, 0.5)))
  const bodyPath = `M${bx} ${by + bh / 2}V${by + bh - r}Q${bx} ${by + bh} ${bx + r} ${by + bh}H${bx + bw - r}Q${bx + bw} ${by + bh} ${bx + bw} ${by + bh - r}V${by + r}Q${bx + bw} ${by} ${bx + bw - r} ${by}H${bx + r}Q${bx} ${by} ${bx} ${by + r}Z`
  const drawBody = prog(b, 0.45, 1, signature)
  const sw = 60 // demi-largeur de l'anse
  const lift = 46 * (1 - spring(b, L.close, { freq: 3, damping: 0.45 }))
  const shY = by - lift
  const shacklePath = `M${cx - sw} ${shY + 8}V${shY - 56}A${sw} ${sw} 0 0 1 ${cx + sw} ${shY - 56}V${shY + (b >= L.close ? 8 : -6)}`
  const drawShackle = prog(b, 1.2, 0.75, signature)
  const closed = b >= L.close
  const flash = closed ? Math.exp(-(b - L.close) * 3) : 0
  const glow = closed ? prog(b, L.close, 0.4) : 0
  const wave = prog(b, L.close, 1.6, expoOut)

  // Sortie : la ligne repart vers la droite (raccord avec le final).
  const exitP = expoIn(prog(b, 7.5, 0.5))
  const exitHead = mix(bx + bw, W + 400, exitP)

  const particle = (p: (typeof PARTICLES)[number], i: number, front: boolean) => {
    const a = p.a0 + b * p.speed * 1.2
    const s = Math.sin(a)
    if (front !== s > 0) return null
    const k = prog(b, 0.6 + (i % 10) * 0.05, 1, expoOut)
    const rr = p.r * (1 + 0.04 * flash) * (vertical ? 0.92 : 1)
    const x = cx + Math.cos(a) * rr
    const y = cy + 20 + s * rr * p.tilt
    const depth = 0.55 + 0.45 * s
    return <circle key={i} cx={x} cy={y} r={p.size * (0.6 + 0.6 * depth)} fill={p.warm ? C.gain : '#A79DF2'} opacity={k * (0.25 + 0.6 * depth)} />
  }

  const chips = [
    { icon: 'server', label: 'Aucun serveur' },
    { icon: 'user', label: 'Aucun compte en ligne' },
    { icon: 'file', label: 'Ton fichier pulse.db, chez toi' },
  ]
  const textTop = vertical ? 1100 : 680

  return (
    <AbsoluteFill>
      <Aurora intensity={0.55 + 0.25 * glow} />
      <Bloom amount={0.35 + 0.9 * flash} radius={26}>
        <AbsoluteFill>
          <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
            {PARTICLES.map((p, i) => particle(p, i, false))}
            {/* Sphère : les données restent à l'intérieur. */}
            <ellipse cx={cx} cy={cy + 20} rx={470 * (vertical ? 0.92 : 1)} ry={470 * 0.36} fill="none" stroke="rgba(167,157,242,.22)" strokeDasharray="2 10" opacity={prog(b, 1, 1)} />
            {b >= L.close && b < L.close + 2 && <ellipse cx={cx} cy={cy + 20} rx={470 * wave} ry={470 * 0.36 * wave} fill="none" stroke="#A79DF2" strokeWidth={2} opacity={0.7 * (1 - wave)} />}
            <defs>
              <linearGradient id="lockfill" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#4A5FD9" stopOpacity=".55" />
                <stop offset="1" stopColor="#8B7FE8" stopOpacity=".35" />
              </linearGradient>
            </defs>
            <path d={bodyPath} fill="url(#lockfill)" opacity={glow} />
            <path d={bodyPath} fill="rgba(13,17,44,.6)" opacity={drawBody * (1 - glow)} />
          </svg>
          {b < 1 && <PulseLine d={`M${Math.max(-200, leadHead - 700)} ${by + bh / 2}L${leadHead} ${by + bh / 2}`} width={3} glow={1.2} head={[leadHead, by + bh / 2]} viewW={W} viewH={H} opacity={1 - prog(b, 0.5, 0.4)} gradX={[0, bx]} />}
          {drawBody > 0 && <PulseLine d={bodyPath} draw={drawBody} width={4} glow={1 + flash} viewW={W} viewH={H} gradX={[bx, bx + bw]} />}
          {drawShackle > 0 && <PulseLine d={shacklePath} draw={drawShackle} width={4} glow={1 + flash} viewW={W} viewH={H} gradX={[cx - sw, cx + sw]} />}
          {/* Serrure. */}
          <svg width={W} height={H} style={{ position: 'absolute', inset: 0, opacity: glow }}>
            <circle cx={cx} cy={by + bh / 2 - 8} r={15} fill="#EDEBFF" />
            <rect x={cx - 5} y={by + bh / 2} width={10} height={34} rx={5} fill="#EDEBFF" />
          </svg>
          <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
            {PARTICLES.map((p, i) => particle(p, i, true))}
          </svg>
          {exitP > 0 && <PulseLine d={`M${Math.max(bx + bw, exitHead - 900)} ${by + bh / 2}L${exitHead} ${by + bh / 2}`} width={3} glow={1.2} head={[exitHead, by + bh / 2]} viewW={W} viewH={H} gradX={[bx + bw, W]} />}
        </AbsoluteFill>
      </Bloom>
      <MaskText
        text={vertical ? ['100 % sur', 'ton ordinateur.'] : '100 % sur ton ordinateur.'}
        b={b}
        at={L.line1}
        stagger={0.07}
        align="center"
        style={{ position: 'absolute', left: 0, right: 0, top: textTop, fontSize: vertical ? 84 : 64, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.08 }}
      />
      <MaskText
        text="Tes données ne partent nulle part."
        b={b}
        at={L.line2}
        stagger={0.05}
        align="center"
        style={{ position: 'absolute', left: 0, right: 0, top: textTop + (vertical ? 216 : 88), fontSize: vertical ? 40 : 32, fontWeight: 500, color: C.tx2 }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: textTop + (vertical ? 320 : 168),
          display: 'flex',
          flexDirection: vertical ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
        }}
      >
        {chips.map((c, i) => {
          const at = L.chips + i * 0.25
          const s = spring(b, at, { freq: 2, damping: 0.6 })
          return (
            <div
              key={c.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: vertical ? '14px 24px' : '10px 20px',
                borderRadius: R.pill,
                background: C.control,
                border: '1px solid rgba(255,255,255,.12)',
                fontSize: vertical ? 28 : 20,
                fontWeight: 500,
                color: C.tx,
                opacity: clamp01((b - at) * 5),
                transform: `translateY(${(1 - s) * 16}px) scale(${0.92 + 0.08 * s})`,
              }}
            >
              <Icon name="check" size={vertical ? 26 : 20} color={C.gain} stroke={2} />
              <Icon name={c.icon} size={vertical ? 26 : 20} color={C.tx2} />
              {c.label}
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}
