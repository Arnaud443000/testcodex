import type { ReactNode } from 'react'
import { AbsoluteFill } from 'remotion'
import { Aurora } from '../fx/Aurora'
import { Shake } from '../fx/Shake'
import { backOut, clamp01, expoOut, quintOut } from '../lib/ease'
import { money } from '../lib/format'
import { rng, noise1 } from '../lib/random'
import { spring, useBeat, useLayout } from '../lib/time'
import { ecgAt, pathOf } from '../ui/ecg'
import { Badge, GlassCard, Notice } from '../ui/Glass'
import { Icon } from '../ui/Icon'
import { PulseLine } from '../ui/PulseLine'
import { C, R } from '../theme'
import { CHAOS_BLACK, CHAOS_SHOTS, type ChaosShot } from '../timeline'

type ShotProps = { shot: ChaosShot; sb: number; sp: number; W: number; H: number; vertical: boolean; u: number; seed: number }

const TONE = { gain: C.gain, loss: C.loss, warn: C.warn, white: C.tx } as const

/** Temps 8–20 : le chaos émotionnel du trading, coupes de plus en plus serrées, puis noir sec. */
export function Chaos() {
  const b = useBeat()
  const { W, H, vertical } = useLayout()
  if (b >= CHAOS_BLACK) return <AbsoluteFill style={{ background: '#000' }} />
  const idx = CHAOS_SHOTS.findIndex((s) => b >= s.start && b < s.end)
  const shot = CHAOS_SHOTS[Math.max(0, idx)]
  const sb = b - shot.start
  const sp = sb / (shot.end - shot.start)
  const k = clamp01((b - 8) / 11) // intensité globale
  const u = Math.min(W, H) / 1080
  const props: ShotProps = { shot, sb, sp, W, H, vertical, u, seed: idx + 1 }
  const tint = shot.tone ? TONE[shot.tone] : shot.kind === 'candlesUp' || shot.kind === 'fomo' ? C.gain : C.loss

  return (
    <AbsoluteFill style={{ filter: `saturate(${1 + k * 0.9}) contrast(${1 + k * 0.18})` }}>
      <Aurora intensity={0.55 - k * 0.25} hueShift={0} />
      <AbsoluteFill style={{ background: `radial-gradient(70% 60% at 50% 55%, ${tint}${Math.round(18 + k * 30).toString(16)}, transparent 70%)` }} />
      <Shake amount={3 + k * k * 22}>
        <Tachy b={b} W={W} H={H} k={k} />
        <Shot {...props} />
      </Shake>
      {/* Éclair blanc très bref à chaque coupe. */}
      <AbsoluteFill style={{ background: '#fff', opacity: 0.16 * Math.exp(-sb * 30) * (0.4 + k), mixBlendMode: 'screen' }} />
    </AbsoluteFill>
  )
}

/** Le coeur s'emballe : ECG rapide en fond, de plus en plus serré. */
function Tachy({ b, W, H, k }: { b: number; W: number; H: number; k: number }) {
  const rate = b < 12 ? 1 : b < 16 ? 0.5 : 0.25
  const beats: number[] = []
  for (let t = 8; t <= b + 1; t += rate) beats.push(t)
  const span = 3.2 // temps visibles
  const pts: [number, number][] = []
  for (let i = 0; i <= 320; i++) {
    const t = b - span + (span * i) / 320
    const y = H * 0.8 - 150 * ecgAt(t, beats) * (rate < 1 ? 0.8 : 1) + noise1(t * 30, 9) * 14 * k
    pts.push([(W * i) / 320, y])
  }
  return (
    <AbsoluteFill style={{ opacity: 0.32 + 0.25 * k }}>
      <PulseLine d={pathOf(pts)} width={2.4} glow={0.9} colors={[C.loss, C.violet]} gradX={[0, W]} fade={{ x: W, len: W * 0.9 }} head={pts[pts.length - 1]} headSize={0.6} viewW={W} viewH={H} />
    </AbsoluteFill>
  )
}

function Shot(p: ShotProps) {
  switch (p.shot.kind) {
    case 'candles':
      return <Candles {...p} up={false} />
    case 'candlesUp':
      return <Candles {...p} up />
    case 'notifs':
      return <Notifs {...p} />
    case 'pnlFlip':
      return <PnlFlip {...p} />
    case 'fomo':
      return <Fomo {...p} />
    case 'revenge':
      return <Revenge {...p} />
    case 'ticket':
      return <Ticket {...p} />
    case 'size':
      return <Big {...p} text="Taille ×3" color={C.warn} sub={<Badge tone="warn" scale={2.2 * p.u}>Taille anormale</Badge>} />
    case 'clock':
      return <Big {...p} text="02:47" color={C.tx} sub={<div style={{ fontSize: 44 * p.u, color: C.tx2, fontWeight: 500 }}>Encore un dernier trade.</div>} />
    case 'stopMoved':
      return <StopMoved {...p} />
    case 'overtrade':
      return <Overtrade {...p} />
    case 'bpm':
      return <Big {...p} text="142 BPM" color={C.loss} sub={<div style={{ fontSize: 40 * p.u, color: C.tx2, fontWeight: 500 }}>Fréquence cardiaque · NAS100 en position</div>} />
    case 'fragment':
      return <Fragment {...p} />
    case 'flash':
      return <Flash {...p} />
  }
}

// ------------------------------------------------------------------ plans

function Candles({ sp, W, H, u, seed, up, vertical }: ShotProps & { up: boolean }) {
  const r = rng(seed * 97 + (up ? 7 : 3))
  const n = 34
  const candles: { o: number; c: number; h: number; l: number }[] = []
  let price = 100
  for (let i = 0; i < n; i++) {
    const drift = (up ? 1 : -1) * (i > n * 0.45 ? 1.6 : 0.3)
    const o = price
    const c = o + drift + (r() - 0.5) * 3.2
    candles.push({ o, c, h: Math.max(o, c) + r() * 1.6, l: Math.min(o, c) - r() * 1.6 })
    price = c
  }
  const lo = Math.min(...candles.map((k) => k.l))
  const hi = Math.max(...candles.map((k) => k.h))
  const cw = (W * 0.86) / n
  const y = (v: number) => H * (vertical ? 0.36 : 0.3) + ((hi - v) / (hi - lo)) * H * (vertical ? 0.5 : 0.58)
  const shown = Math.ceil(n * (0.55 + 0.45 * expoOut(sp)))
  const push = 1 + 0.1 * quintOut(sp)
  const last = candles[shown - 1]
  return (
    <AbsoluteFill style={{ transform: `perspective(1400px) rotateX(${vertical ? 8 : 14}deg) rotateZ(${up ? 2 : -2}deg) scale(${push})` }}>
      <svg width={W} height={H} style={{ position: 'absolute', left: W * 0.02 }}>
        {[0.2, 0.4, 0.6, 0.8].map((f) => (
          <line key={f} x1={0} x2={W * 1.2} y1={H * f} y2={H * f} stroke="rgba(255,255,255,.05)" />
        ))}
        {candles.slice(0, shown).map((k, i) => {
          const col = k.c >= k.o ? C.gain : C.loss
          const x = i * cw + cw / 2
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={y(k.h)} y2={y(k.l)} stroke={col} strokeWidth={2} />
              <rect x={x - cw * 0.32} y={y(Math.max(k.o, k.c))} width={cw * 0.64} height={Math.max(2, Math.abs(y(k.o) - y(k.c)))} rx={3} fill={col} />
            </g>
          )
        })}
        <line x1={0} x2={W * 1.2} y1={y(last.c)} y2={y(last.c)} stroke={up ? C.gain : C.loss} strokeDasharray="6 6" opacity={0.6} />
      </svg>
      <div style={{ position: 'absolute', left: Math.min(W - 520 * u, W * 0.02 + shown * cw + 24 * u), top: y(last.c) - 22 * u }}>
        <span style={{ background: up ? C.gain : C.loss, color: '#0B0E27', fontWeight: 700, fontSize: 26 * u, padding: `${6 * u}px ${16 * u}px`, borderRadius: R.pill }}>
          {up ? 'NAS100 · 18 412,5' : 'EUR/USD · 1,0842'}
        </span>
      </div>
      <div style={{ position: 'absolute', left: vertical ? 80 : 160, top: vertical ? H * 0.12 : H * 0.14, fontSize: 132 * u, fontWeight: 700, letterSpacing: '-0.03em', color: up ? C.gain : C.loss, textShadow: '0 0 40px rgba(0,0,0,.6)' }}>
        {up ? money(1860) : money(-1240)}
      </div>
    </AbsoluteFill>
  )
}

function Notifs({ sb, shot, W, H, u, vertical }: ShotProps) {
  const fast = shot.end - shot.start < 0.5
  const items: { tone: 'ok' | 'warn' | 'bad' | 'glass'; icon: string; text: string }[] = [
    { tone: 'bad', icon: 'alert', text: 'Stop touché · NAS100 · −380,00 €' },
    { tone: 'warn', icon: 'alert', text: 'Marge utilisée : 87 %' },
    { tone: 'glass', icon: 'bell', text: 'Ordre exécuté · Achat 2,00 lots EUR/USD' },
    { tone: 'bad', icon: 'alert', text: '3 pertes d’affilée aujourd’hui' },
  ]
  const w = (vertical ? 920 : 860) * u * (vertical ? 1.1 : 1)
  return (
    <AbsoluteFill>
      {items.map((it, i) => {
        const s = fast ? 1 : spring(sb, i * 0.16 - 0.14, { freq: 2.2, damping: 0.55 })
        const x = (1 - s) * 700
        const top = H * (vertical ? 0.3 : 0.2) + i * 132 * u
        const left = vertical ? (W - w) / 2 : W - w - 160
        const style = { width: w, transform: `translateX(${x}px) rotate(${(1 - s) * 6}deg)`, opacity: clamp01(s * 3), fontSize: 30 * u, padding: `${22 * u}px ${26 * u}px`, boxShadow: '0 30px 60px -20px rgba(0,0,0,.7)' }
        return (
          <div key={i} style={{ position: 'absolute', left, top }}>
            {it.tone === 'glass' ? (
              <div style={{ ...style, display: 'flex', gap: 16, alignItems: 'center', borderRadius: R.inner, background: 'rgba(22,26,60,.92)', border: `1px solid ${C.glassBorder}`, color: C.tx }}>
                <Icon name={it.icon} size={32 * u} color={C.txAccent} />
                {it.text}
              </div>
            ) : (
              <Notice tone={it.tone} style={{ ...style, background: it.tone === 'bad' ? 'rgba(58,33,30,.95)' : 'rgba(54,44,28,.95)' }}>
                <Icon name={it.icon} size={32 * u} />
                {it.text}
              </Notice>
            )}
          </div>
        )
      })}
    </AbsoluteFill>
  )
}

function PnlFlip({ sp, H, W, u }: ShotProps) {
  const flip = clamp01((sp - 0.42) / 0.16)
  const e = expoOut(flip)
  const row = (text: string, color: string) => (
    <div style={{ height: 220 * u, lineHeight: `${220 * u}px`, color, fontSize: 196 * u, fontWeight: 700, letterSpacing: '-0.035em', whiteSpace: 'nowrap' }}>{text}</div>
  )
  // Sparkline qui s'effondre derrière.
  const pts: [number, number][] = []
  for (let i = 0; i <= 60; i++) {
    const t = i / 60
    const v = t < 0.5 ? t * 0.6 : 0.3 - (t - 0.5) * 2.2 * e
    pts.push([W * 0.1 + t * W * 0.8, H * 0.62 - v * H * 0.45 + noise1(i * 0.7, 2) * 18])
  }
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <PulseLine d={pathOf(pts)} width={3} glow={0.6} colors={[C.gain, e > 0.5 ? C.loss : C.gain]} gradX={[W * 0.1, W * 0.9]} opacity={0.45} viewW={W} viewH={H} />
      <div style={{ fontSize: 26 * u, letterSpacing: '0.12em', fontWeight: 600, color: C.tx2, marginBottom: 8 * u, textTransform: 'uppercase' }}>Résultat du jour</div>
      <div style={{ height: 220 * u, overflow: 'hidden' }}>
        <div style={{ transform: `translateY(${-e * 220 * u}px)` }}>
          {row(money(2180), C.gain)}
          {row(money(-3460), C.loss)}
        </div>
      </div>
    </AbsoluteFill>
  )
}

function Chip({ children, x, y, s, u, bad }: { children: ReactNode; x: number; y: number; s: number; u: number; bad?: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: `scale(${s})`,
        opacity: clamp01(s * 2),
        fontSize: 30 * u,
        fontWeight: 500,
        padding: `${12 * u}px ${24 * u}px`,
        borderRadius: R.pill,
        background: bad ? 'rgba(240,119,107,.16)' : 'linear-gradient(135deg, rgba(74,95,217,.38), rgba(139,127,232,.26))',
        border: `1px solid ${bad ? 'rgba(240,119,107,.5)' : 'rgba(139,127,232,.6)'}`,
        color: bad ? '#F5A198' : '#fff',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </div>
  )
}

function Fomo({ sb, sp, W, H, u, vertical }: ShotProps) {
  const punch = 1.25 - 0.25 * expoOut(sp) + 0.04 * Math.sin(sb * 40) * (1 - sp)
  const chips = [
    { t: 'Ça part sans moi', x: 0.14, y: 0.22 },
    { t: 'Entrée tardive', x: 0.66, y: 0.7 },
    { t: 'Pas de plan', x: 0.62, y: 0.18 },
    { t: 'Tout le monde est long', x: 0.1, y: 0.74 },
  ]
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0, opacity: 0.5 }}>
        <rect x={W * 0.47} y={H * (0.75 - 0.6 * expoOut(sp))} width={W * 0.06} height={H * 0.6 * expoOut(sp)} rx={8} fill={C.gain} opacity={0.35} />
      </svg>
      <div style={{ fontSize: (vertical ? 300 : 380) * u, fontWeight: 800, letterSpacing: '-0.05em', color: C.warn, transform: `scale(${punch})`, textShadow: '0 0 60px rgba(217,168,90,.45)' }}>FOMO</div>
      {chips.map((c, i) => (
        <Chip key={i} x={W * c.x} y={H * c.y} s={backOut(1.6)(clamp01((sb - 0.08 - i * 0.1) / 0.3))} u={u} bad={i % 2 === 1}>
          {c.t}
        </Chip>
      ))}
    </AbsoluteFill>
  )
}

function Revenge({ sb, sp, u }: ShotProps) {
  const s = backOut(1.8)(clamp01(sb / 0.25))
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 28 * u, flexDirection: 'column' }}>
      {[3, 2, 1].map((e) => (
        <div key={e} style={{ position: 'absolute', transform: `scale(${1 + e * 0.12 * expoOut(sp)})`, opacity: 0.12 * (4 - e) * (1 - sp) }}>
          <RevengeChip u={u} />
        </div>
      ))}
      <div style={{ transform: `scale(${s})` }}>
        <RevengeChip u={u} />
      </div>
      <div style={{ fontSize: 36 * u, color: C.tx2, fontWeight: 500, opacity: clamp01((sb - 0.1) * 5) }}>2 min après une perte · taille ×3</div>
    </AbsoluteFill>
  )
}
function RevengeChip({ u }: { u: number }) {
  return (
    <div style={{ fontSize: 96 * u, fontWeight: 700, letterSpacing: '-0.02em', padding: `${24 * u}px ${56 * u}px`, borderRadius: R.pill, background: 'rgba(240,119,107,.16)', border: `2px solid rgba(240,119,107,.6)`, color: '#F5A198', whiteSpace: 'nowrap' }}>
      Trade de revanche
    </div>
  )
}

function Ticket({ sb, u, vertical }: ShotProps) {
  const press = sb > 0.28 ? 1 - 0.06 * Math.exp(-(sb - 0.28) * 20) : 1
  const s = spring(sb, 0, { freq: 2.6, damping: 0.6 })
  const cw = (vertical ? 860 : 760) * u
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ transform: `perspective(1200px) rotateY(${(1 - s) * -30 - 8}deg) rotateX(6deg) scale(${0.9 + 0.1 * s})` }}>
        <GlassCard w={cw} h={360 * u} style={{ padding: `${32 * u}px ${36 * u}px` }}>
          <div style={{ fontSize: 30 * u, fontWeight: 600 }}>Nouvel ordre · NAS100</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28 * u, fontSize: 26 * u, color: C.tx2 }}>
            <span>Taille</span>
            <b style={{ color: C.warn }}>3,00 lots</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 * u, fontSize: 26 * u, color: C.tx2 }}>
            <span>Stop loss</span>
            <b style={{ color: C.loss }}>aucun</b>
          </div>
          <div style={{ display: 'flex', gap: 20 * u, marginTop: 44 * u }}>
            <div style={{ flex: 1, textAlign: 'center', padding: `${22 * u}px 0`, borderRadius: R.pill, background: C.gain, color: '#0B0E27', fontWeight: 700, fontSize: 32 * u }}>ACHETER</div>
            <div style={{ flex: 1, textAlign: 'center', padding: `${22 * u}px 0`, borderRadius: R.pill, background: C.loss, color: '#0B0E27', fontWeight: 700, fontSize: 32 * u, transform: `scale(${press})`, boxShadow: sb > 0.28 ? '0 0 40px rgba(240,119,107,.7)' : undefined }}>VENDRE</div>
          </div>
        </GlassCard>
      </div>
    </AbsoluteFill>
  )
}

function Big({ sb, text, color, sub, u, vertical }: ShotProps & { text: string; color: string; sub: ReactNode }) {
  const s = 1.18 - 0.18 * expoOut(clamp01(sb / 0.4))
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 28 * u }}>
      <div style={{ fontSize: (vertical ? 200 : 260) * u, fontWeight: 700, letterSpacing: '-0.04em', color, transform: `scale(${s})`, whiteSpace: 'nowrap', textShadow: `0 0 50px ${color}55` }}>{text}</div>
      <div style={{ opacity: clamp01((sb - 0.05) * 6) }}>{sub}</div>
    </AbsoluteFill>
  )
}

function StopMoved({ sb, sp, W, H, u, vertical }: ShotProps) {
  const pts: [number, number][] = []
  for (let i = 0; i <= 80; i++) {
    const t = i / 80
    pts.push([W * 0.08 + t * W * 0.84, H * 0.42 + t * H * 0.18 + noise1(i * 0.5, 5) * 26])
  }
  const sl = H * 0.58 + H * 0.2 * expoOut(clamp01(sb / 0.35))
  return (
    <AbsoluteFill>
      <PulseLine d={pathOf(pts)} width={3} glow={0.5} colors={[C.violet, C.loss]} gradX={[0, W]} viewW={W} viewH={H} />
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        <line x1={0} x2={W} y1={H * 0.58} y2={H * 0.58} stroke={C.loss} strokeDasharray="10 10" opacity={0.25 * (1 - sp)} strokeWidth={2} />
        <line x1={0} x2={W} y1={sl} y2={sl} stroke={C.loss} strokeDasharray="10 10" strokeWidth={3} />
      </svg>
      <div style={{ position: 'absolute', right: 120 * u, top: sl - 24 * u, background: C.loss, color: '#0B0E27', fontWeight: 700, fontSize: 28 * u, padding: `${6 * u}px ${18 * u}px`, borderRadius: R.pill }}>SL</div>
      <div style={{ position: 'absolute', left: vertical ? 80 : 160, top: H * 0.14, fontSize: 120 * u, fontWeight: 700, letterSpacing: '-0.03em' }}>Stop déplacé</div>
    </AbsoluteFill>
  )
}

function Overtrade({ sb, W, H, u, vertical }: ShotProps) {
  const rows = Array.from({ length: 14 }, (_, i) => i)
  const r = rng(77)
  // Horaires croissants de 09:02 à 16:41 : une journée réelle, trade après trade.
  const data = rows.map((i) => {
    const m = 9 * 60 + 2 + Math.round(i * 33 + r() * 20)
    return { side: r() > 0.5 ? 'Long' : 'Short', pnl: Math.round((r() - 0.62) * 900), t: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }
  })
  const scroll = expoOut(clamp01(sb / 0.5)) * 340 * u
  const cw = vertical ? W - 160 : 900 * u
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: vertical ? 80 : 160, top: H * (vertical ? 0.12 : 0.16), fontSize: 110 * u, fontWeight: 700, letterSpacing: '-0.03em', width: vertical ? W - 160 : 640 * u, lineHeight: 1.02 }}>
        14 trades aujourd’hui
      </div>
      <div style={{ position: 'absolute', right: vertical ? 80 : 160, top: H * (vertical ? 0.36 : 0.12), width: cw, height: H * (vertical ? 0.55 : 0.76), overflow: 'hidden', borderRadius: R.card }}>
        <div style={{ transform: `translateY(${-scroll}px)` }}>
          {data.map((d, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 76 * u, borderBottom: `1px solid ${C.hairline}`, fontSize: 30 * u, padding: `0 ${20 * u}px` }}>
              <span style={{ color: C.tx3 }}>{d.t}</span>
              <span>NAS100</span>
              <span style={{ color: d.side === 'Long' ? C.gain : C.loss }}>{d.side}</span>
              <b style={{ color: d.pnl >= 0 ? C.gain : C.loss, width: 220 * u, textAlign: 'right' }}>{money(d.pnl)}</b>
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  )
}

function Fragment({ shot, seed, sb, u }: ShotProps) {
  const r = rng(seed * 31)
  const rot = (r() - 0.5) * 12
  const dx = (r() - 0.5) * 360 * u
  const dy = (r() - 0.5) * 220 * u
  const col = TONE[shot.tone ?? 'white']
  const s = 1.3 - 0.3 * expoOut(clamp01(sb / 0.25))
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(${s})`, fontSize: 220 * u, fontWeight: 800, letterSpacing: '-0.04em', color: col, whiteSpace: 'nowrap', textShadow: `0 0 60px ${col}66` }}>{shot.text}</div>
    </AbsoluteFill>
  )
}

function Flash({ shot, seed, u, W }: ShotProps) {
  const r = rng(seed * 13)
  const col = TONE[shot.tone ?? 'white']
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', background: `${col}${seed % 2 ? '55' : '30'}` }}>
      <div style={{ fontSize: (shot.text && shot.text.length < 3 ? 520 : 240) * u, fontWeight: 800, color: seed % 2 ? '#0B0E27' : col, transform: `translateX(${(r() - 0.5) * W * 0.3}px) rotate(${(r() - 0.5) * 10}deg)`, letterSpacing: '-0.04em', whiteSpace: 'nowrap' }}>{shot.text}</div>
    </AbsoluteFill>
  )
}
