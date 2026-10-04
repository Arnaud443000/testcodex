import type { ReactNode } from 'react'
import { clamp01, expoOut, quintOut, signature } from '../lib/ease'
import { money, MINUS, num, pct, rMul } from '../lib/format'
import { prog, spring } from '../lib/time'
import { partial, smoothPath } from '../ui/ecg'
import { Badge, Caption, CardTitle, GlassCard, Inner, Notice, Pill } from '../ui/Glass'
import { Icon } from '../ui/Icon'
import { PulseLine } from '../ui/PulseLine'
import { equityAt } from '../ui/series'
import { noise1 } from '../lib/random'
import { count } from '../ui/Text'
import { C, GRAD, R } from '../theme'

/**
 * Les six écrans des super-pouvoirs : composants fidèles à l'app (cartes en verre, badges,
 * notices, anneau de score, heatmap…), données plausibles et cohérentes entre elles
 * (3 mois, 182 trades, résultat net +12 480,00 €). `b` = temps local au plan ; un grand `b`
 * donne l'état final (utilisé par la constellation du final).
 */

export type CardProps = { b: number }
/** Le trait lumineux entre dans la carte à `entry` et en sort par `exit` (coordonnées de la carte). */
export type CardDef = { w: number; h: number; entry: [number, number]; exit: [number, number]; Card: (p: CardProps) => ReactNode }

/** Le trait arrive au point d'entrée à ce temps local, puis dessine la visualisation. */
export const DRAW_AT = 0.45
const P = { x: 24, y: 22 } // padding de carte (charte 5.3)

/** Apparition d'un élément d'interface : montée courte + fondu, en ressort léger. */
function pop(b: number, at: number) {
  const s = spring(b, at, { freq: 2, damping: 0.7 })
  return { opacity: clamp01((b - at) * 5), transform: `translateY(${(1 - s) * 14}px)` }
}

const Row = ({ children, style }: { children: ReactNode; style?: React.CSSProperties }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...style }}>{children}</div>
)

// ================================================================ 01 Résumé de période

const F1_CHART = { x0: 0, x1: 832, base: 372, h: 196 }
const f1Pts = (() => {
  const pts: [number, number][] = []
  for (let i = 0; i <= 120; i++) pts.push([P.x + F1_CHART.x0 + ((F1_CHART.x1 - F1_CHART.x0) * i) / 120, P.y + F1_CHART.base - equityAt(i / 120) * F1_CHART.h])
  return pts
})()

function F1({ b }: CardProps) {
  const draw = prog(b, DRAW_AT, 1.4, signature)
  const { pts, head } = partial(f1Pts, draw)
  const net = count(b, 1.25, 12480, 1.6)
  const kpis: { label: string; value: string; color: string; at: number; delta: string; up: boolean }[] = [
    { label: 'Taux de réussite', value: pct(count(b, 1.75, 58, 1)), color: C.tx, at: 1.75, delta: '+3,2 pts', up: true },
    { label: 'Espérance', value: rMul(count(b, 2, 0.42, 1)), color: C.gain, at: 2, delta: '+0,08 R', up: true },
    { label: 'Profit factor', value: num(count(b, 2.25, 1.74, 1), 2), color: C.tx, at: 2.25, delta: '+0,12', up: true },
    { label: 'Drawdown max', value: `${MINUS}${num(count(b, 2.5, 6.2, 1), 1)} %`, color: C.loss, at: 2.5, delta: '−1,4 pt', up: true },
  ]
  return (
    <GlassCard w={880} h={600}>
      <Row>
        <Caption>Résultat net · 3 derniers mois</Caption>
        <div style={{ display: 'flex', gap: 8, ...pop(b, 1.25) }}>
          <Badge tone="gain">Gain</Badge>
          <Pill style={{ padding: '4px 12px', fontSize: 12.5, fontWeight: 600 }}>182 trades</Pill>
        </div>
      </Row>
      <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 6, background: 'linear-gradient(180deg,#fff,#C9D2FF)', WebkitBackgroundClip: 'text', color: 'transparent', opacity: clamp01((b - 1.1) * 4) }}>
        {money(net)}
      </div>
      <div style={{ fontSize: 15, color: C.gain, fontWeight: 600, marginTop: 2, ...pop(b, 1.5) }}>
        ▲ +8,4 % <span style={{ color: C.tx2, fontWeight: 400 }}>vs 3 mois précédents</span>
      </div>
      {/* Courbe d'équité : le trait lumineux du film devient la courbe. */}
      <svg width={880} height={600} style={{ position: 'absolute', left: -P.x, top: -P.y, overflow: 'visible' }}>
        <defs>
          <linearGradient id="f1fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8B7FE8" stopOpacity=".30" />
            <stop offset="1" stopColor="#4A5FD9" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.33, 0.66, 1].map((f) => (
          <line key={f} x1={P.x} x2={P.x + 832} y1={P.y + F1_CHART.base - F1_CHART.h * f} y2={P.y + F1_CHART.base - F1_CHART.h * f} stroke="rgba(255,255,255,.05)" />
        ))}
        {pts.length > 2 && <path d={`${smoothPath(pts)}L${head[0]} ${P.y + F1_CHART.base}L${P.x} ${P.y + F1_CHART.base}Z`} fill="url(#f1fill)" />}
        {['juil.', 'août', 'sept.'].map((m, i) => (
          <text key={m} x={P.x + 60 + i * 290} y={P.y + F1_CHART.base + 22} fill={C.tx3} fontSize={12}>
            {m}
          </text>
        ))}
      </svg>
      {pts.length > 1 && (
        <div style={{ position: 'absolute', left: -P.x, top: -P.y }}>
          <PulseLine d={smoothPath(pts)} width={2.4} glow={0.7} head={head} headSize={draw < 1 ? 0.9 : 0.55} gradX={[P.x, P.x + 832]} viewW={880} viewH={600} core={0.5} />
        </div>
      )}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 420, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {kpis.map((k) => (
          <Inner key={k.label} style={{ padding: '14px 16px', ...pop(b, k.at) }}>
            <div style={{ fontSize: 13, color: C.tx2, fontWeight: 500 }}>{k.label}</div>
            <div style={{ fontSize: 28, fontWeight: 600, color: k.color, marginTop: 4, letterSpacing: '-0.01em' }}>{k.value}</div>
            <div style={{ fontSize: 12.5, color: C.gain, fontWeight: 600, marginTop: 2 }}>
              ▲ {k.delta} <span style={{ color: C.tx3, fontWeight: 400 }}>vs mois dernier</span>
            </div>
          </Inner>
        ))}
      </div>
    </GlassCard>
  )
}

// ================================================================ 02 Discipline

const RING = { cx: P.x + 136, cy: P.y + 196, r: 112, sw: 18 }
const COMPONENTS = [
  { label: 'Respect du plan', weight: 30, v: 80 },
  { label: 'Règles personnelles', weight: 25, v: 84 },
  { label: 'Checklist pré-trade', weight: 15, v: 74 },
  { label: 'Stop loss prévu', weight: 10, v: 95 },
  { label: 'Risque dans la limite', weight: 10, v: 82 },
  { label: 'Sans revanche ni surtrading', weight: 10, v: 81 },
]

function F2({ b }: CardProps) {
  const fill = prog(b, DRAW_AT, 2.2, (t) => 1 - Math.pow(1 - t, 3)) * 0.82
  const circ = 2 * Math.PI * RING.r
  const score = Math.round(fill * 100)
  const end = -Math.PI / 2 + fill * 2 * Math.PI
  const head: [number, number] = [RING.cx + RING.r * Math.cos(end), RING.cy + RING.r * Math.sin(end)]
  return (
    <GlassCard w={880} h={600}>
      <CardTitle right={<Pill style={{ ...pop(b, 1) }}>3 derniers mois</Pill>}>Score de discipline</CardTitle>
      <svg width={880} height={600} style={{ position: 'absolute', left: -P.x, top: -P.y, overflow: 'visible' }}>
        <defs>
          <linearGradient id="f2ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4A5FD9" />
            <stop offset="1" stopColor="#8B7FE8" />
          </linearGradient>
        </defs>
        <circle cx={RING.cx} cy={RING.cy} r={RING.r} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth={RING.sw} />
        {fill > 0.001 && (
          <circle
            cx={RING.cx}
            cy={RING.cy}
            r={RING.r}
            fill="none"
            stroke="url(#f2ring)"
            strokeWidth={RING.sw}
            strokeLinecap="round"
            strokeDasharray={`${fill * circ} ${circ}`}
            transform={`rotate(-90 ${RING.cx} ${RING.cy})`}
            style={{ filter: 'drop-shadow(0 0 8px rgba(139,127,232,.6))' }}
          />
        )}
        {fill > 0.001 && fill < 0.8199 && <circle cx={head[0]} cy={head[1]} r={7} fill="#fff" style={{ filter: 'drop-shadow(0 0 10px #A79DF2)' }} />}
      </svg>
      <div style={{ position: 'absolute', left: RING.cx - P.x - 100, top: RING.cy - P.y - 44, width: 200, textAlign: 'center' }}>
        <div style={{ fontSize: 60, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.02em' }}>{score}</div>
        <div style={{ fontSize: 14, color: C.tx3, marginTop: 6 }}>/ 100</div>
      </div>
      <div style={{ position: 'absolute', left: 320, right: 0, top: 58 }}>
        {COMPONENTS.map((c, i) => {
          const at = 1.5 + i * 0.25
          const w = prog(b, at, 1.1, quintOut) * c.v
          return (
            <div key={c.label} style={{ marginBottom: 14, ...pop(b, at) }}>
              <Row style={{ fontSize: 15 }}>
                <span style={{ color: C.tx2 }}>
                  {c.label} <span style={{ color: C.tx3, fontSize: 12.5 }}>· poids {c.weight}</span>
                </span>
                <b style={{ fontWeight: 600 }}>{Math.round(w)} %</b>
              </Row>
              <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,.07)', marginTop: 7 }}>
                <div style={{ height: 6, borderRadius: 3, width: `${w}%`, background: GRAD }} />
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 420, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Inner style={pop(b, 3)}>
          <Caption>Dans le plan · 141 trades</Caption>
          <div style={{ fontSize: 28, fontWeight: 600, color: C.gain, marginTop: 6 }}>+0,61 R</div>
          <div style={{ fontSize: 13, color: C.tx2, marginTop: 2 }}>Taux de réussite 64 % · {money(14210)}</div>
        </Inner>
        <Inner style={pop(b, 3.25)}>
          <Caption>Hors plan · 23 trades</Caption>
          <div style={{ fontSize: 28, fontWeight: 600, color: C.loss, marginTop: 6 }}>−0,38 R</div>
          <div style={{ fontSize: 13, color: C.tx2, marginTop: 2 }}>Taux de réussite 28 % · {money(-1730)}</div>
        </Inner>
      </div>
    </GlassCard>
  )
}

// ================================================================ 03 Erreurs récurrentes

const MISTAKES = [
  { label: 'Trade de revanche', n: 9, share: 4.9, cost: 1620 },
  { label: 'Surtrading', n: 14, share: 7.7, cost: 1180 },
  { label: 'Sortie trop tôt', n: 22, share: 12.1, cost: 940 },
  { label: 'Mauvaise gestion du risque', n: 7, share: 3.8, cost: 860 },
  { label: 'Stop déplacé', n: 5, share: 2.7, cost: 410 },
]

function F3({ b }: CardProps) {
  const rule = prog(b, DRAW_AT, 1, signature)
  return (
    <GlassCard w={880} h={600}>
      <CardTitle
        right={
          <div style={{ display: 'flex', gap: 6, ...pop(b, 1) }}>
            <Pill active>Par coût</Pill>
            <Pill>Par nombre</Pill>
          </div>
        }
      >
        Erreurs récurrentes
      </CardTitle>
      {/* Le trait lumineux devient le filet sous l'en-tête. */}
      <div style={{ position: 'absolute', left: 0, top: 52, height: 2, width: `${rule * 100}%`, background: 'linear-gradient(90deg, #4A5FD9, #8B7FE8)', boxShadow: '0 0 12px rgba(139,127,232,.9)', opacity: 1 - prog(b, 1.6, 1) * 0.75 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 70 }}>
        {MISTAKES.map((m, i) => {
          const at = 1.5 + i * 0.25
          const bar = prog(b, at + 0.1, 1.2, quintOut) * (m.cost / 1620)
          return (
            <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 16, height: 72, borderBottom: i < 4 ? `1px solid ${C.hairline}` : undefined, ...pop(b, at) }}>
              <div style={{ width: 36, height: 36, borderRadius: R.sm, background: C.lossBg, color: C.loss, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14 }}>{m.n}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 500 }}>{m.label}</div>
                <div style={{ fontSize: 13, color: C.tx3, marginTop: 2 }}>
                  {m.n} trades · {num(m.share, 1)} % des trades
                </div>
                <div style={{ height: 4, borderRadius: 2, marginTop: 6, width: `${bar * 100}%`, background: 'rgba(240,119,107,.55)' }} />
              </div>
              <div style={{ fontSize: 17, fontWeight: 600, color: C.loss, width: 140, textAlign: 'right' }}>{money(-m.cost)}</div>
            </div>
          )
        })}
      </div>
      <Notice tone="bad" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, ...pop(b, 3.5) }}>
        <Icon name="alert" size={18} />
        <span>
          Coût total des erreurs : <b>{money(-5010)}</b> · 48 trades sur 182 portent au moins une erreur.
        </span>
      </Notice>
    </GlassCard>
  )
}

// ================================================================ 04 Risque : drawdown + heatmap

/**
 * Courbe « sous l'eau » : baisse depuis le dernier sommet, en %. Cinq creux plausibles sur
 * 3 mois, dont le drawdown max de −6,2 % (fin août), comme sur le plan 01.
 */
const DD = (() => {
  const dips: [number, number, number][] = [
    [0.16, 0.035, 1.6],
    [0.33, 0.045, 2.9],
    [0.58, 0.06, 6.2],
    [0.79, 0.035, 2.2],
    [0.93, 0.025, 1.1],
  ]
  const out: number[] = []
  for (let i = 0; i <= 120; i++) {
    const t = i / 120
    let v = 0
    // Chute rapide, remontée lente : la forme réelle d'un drawdown.
    for (const [c, w, a] of dips) {
      const ww = t < c ? w * 0.55 : w * 1.5
      v = Math.min(v, -a * Math.exp(-((t - c) ** 2) / (2 * ww * ww)))
    }
    out.push(v + (v < -0.2 ? 0.12 * noise1(t * 40, 21) : 0))
  }
  const min = Math.min(...out)
  return out.map((v) => Math.min(0, (v / min) * -6.2))
})()
const DDW = { w: 700, h: 440, x0: P.x, x1: 700 - P.x, top: P.y + 92, scale: 30 } // 1 % = 30 px

function DrawdownCard({ b }: CardProps) {
  const draw = prog(b, DRAW_AT, 1.5, signature)
  const pts = DD.map((v, i) => [DDW.x0 + ((DDW.x1 - DDW.x0) * i) / (DD.length - 1), DDW.top - v * DDW.scale] as [number, number])
  const { pts: shown, head } = partial(pts, draw)
  const minI = DD.indexOf(Math.min(...DD))
  const danger = DDW.top + 5 * DDW.scale
  const reached = draw >= minI / (DD.length - 1)
  const pulse = reached ? 0.5 + 0.5 * Math.sin(b * Math.PI * 2) : 0
  return (
    <GlassCard w={DDW.w} h={DDW.h}>
      <CardTitle right={<Badge tone="loss">Max −6,2 %</Badge>}>Drawdown</CardTitle>
      <svg width={DDW.w} height={DDW.h} style={{ position: 'absolute', left: -P.x, top: -P.y, overflow: 'visible' }}>
        <defs>
          <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(217,168,90,.42)" strokeWidth="3" />
          </pattern>
          <linearGradient id="ddfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#F0776B" stopOpacity="0" />
            <stop offset="1" stopColor="#F0776B" stopOpacity=".28" />
          </linearGradient>
        </defs>
        <rect x={DDW.x0} y={danger} width={DDW.x1 - DDW.x0} height={2.2 * DDW.scale} fill="url(#hatch)" opacity={prog(b, 1.25, 0.6)} />
        <line x1={DDW.x0} x2={DDW.x1} y1={danger} y2={danger} stroke={C.warn} strokeDasharray="6 6" opacity={prog(b, 1.25, 0.6)} />
        {[0, -2, -4, -6].map((v) => (
          <g key={v}>
            <line x1={DDW.x0} x2={DDW.x1} y1={DDW.top - v * DDW.scale} y2={DDW.top - v * DDW.scale} stroke="rgba(255,255,255,.05)" />
            <text x={DDW.x1} y={DDW.top - v * DDW.scale - 6} textAnchor="end" fill={C.tx3} fontSize={12}>
              {v === 0 ? '0 %' : `${MINUS}${-v} %`}
            </text>
          </g>
        ))}
        {shown.length > 2 && <path d={`${smoothPath(shown)}L${head[0]} ${DDW.top}L${DDW.x0} ${DDW.top}Z`} fill="url(#ddfill)" />}
        {reached && (
          <g transform={`translate(${pts[minI][0]} ${pts[minI][1]})`}>
            <circle r={10 + pulse * 10} fill="none" stroke={C.loss} opacity={0.6 - pulse * 0.5} />
            <circle r={5} fill={C.loss} />
          </g>
        )}
      </svg>
      <div style={{ position: 'absolute', left: -P.x, top: -P.y }}>
        {shown.length > 1 && <PulseLine d={smoothPath(shown)} width={2.4} glow={0.7} colors={['#8B7FE8', '#F0776B']} gradX={[DDW.x0, DDW.x1]} head={draw < 1 ? head : null} headSize={0.8} viewW={DDW.w} viewH={DDW.h} core={0.5} />}
      </div>
      <div style={{ position: 'absolute', left: DDW.x0 - P.x + 8, top: danger - P.y + 14, fontSize: 13, fontWeight: 600, color: '#F0CE8E', opacity: prog(b, 1.5, 0.6) }}>Zone de danger · au-delà de −5 %</div>
      {reached && (
        <div style={{ position: 'absolute', left: pts[minI][0] - P.x + 16, top: pts[minI][1] - P.y - 34, fontSize: 15, fontWeight: 700, color: C.loss }}>−6,2 %</div>
      )}
      <Notice tone="warn" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, ...pop(b, 2) }}>
        <Icon name="alert" size={18} />
        <span>
          Risque max <b>1 % par trade</b> · 3 dépassements ce mois-ci
        </span>
      </Notice>
    </GlassCard>
  )
}

const DAYS = ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.']
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16]
// PnL net par case (€) : matinées solides, vendredi après-midi coûteux.
const HEAT = [
  [120, 410, 520, 260, 0, -90, 140, -60, 0],
  [80, 380, 610, 190, -40, 0, 210, -120, -80],
  [0, 290, 470, 330, 60, -140, 90, -210, 0],
  [150, 520, 380, 240, 0, 70, -60, -180, -90],
  [60, 340, 250, -120, -260, -380, -540, -620, -310],
]
export const HEAT_W = 560
export const HEAT_H = 380

function HeatmapCard({ b }: CardProps) {
  const max = 620
  return (
    <GlassCard w={HEAT_W} h={HEAT_H}>
      <CardTitle right={<span style={{ fontSize: 12.5, color: C.tx3 }}>heure d’entrée</span>}>Heatmap jour × heure</CardTitle>
      <div style={{ display: 'grid', gridTemplateColumns: `44px repeat(${HOURS.length}, 1fr)`, gap: 6, marginTop: 4 }}>
        <div />
        {HOURS.map((h) => (
          <div key={h} style={{ fontSize: 11.5, color: C.tx3, textAlign: 'center' }}>
            {String(h).padStart(2, '0')} h
          </div>
        ))}
        {DAYS.map((d, r) => (
          <Fragment2 key={d}>
            <div style={{ fontSize: 12.5, color: C.tx2, alignSelf: 'center' }}>{d}</div>
            {HEAT[r].map((v, c) => {
              const at = 2.9 + (r + c) * 0.045
              const a = prog(b, at, 0.5, expoOut)
              const tier = Math.abs(v) / max
              const alpha = v === 0 ? 0 : tier > 0.66 ? 0.62 : tier > 0.33 ? 0.38 : 0.18
              const base = v > 0 ? '95,203,158' : '240,119,107'
              return (
                <div
                  key={c}
                  style={{
                    height: 42,
                    borderRadius: R.sm,
                    background: v === 0 ? 'rgba(255,255,255,.05)' : `rgba(${base},${alpha})`,
                    boxShadow: alpha > 0.6 ? `0 0 14px -2px rgba(${base},.55)` : undefined,
                    opacity: a,
                    transform: `scale(${0.6 + 0.4 * a})`,
                    display: 'grid',
                    placeItems: 'end',
                    padding: '0 5px 3px',
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: C.tx,
                  }}
                >
                  {v === 0 ? '' : v > 0 ? `+${v}` : `${MINUS}${-v}`}
                </div>
              )
            })}
          </Fragment2>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 14, fontSize: 12.5, color: C.tx2, ...pop(b, 3.5) }}>
        <span style={{ color: C.loss, fontWeight: 600 }}>Vendredi après 13 h : {money(-2110, 0)}</span>
        <span>· 11 trades</span>
      </div>
    </GlassCard>
  )
}
const Fragment2 = ({ children }: { children: ReactNode }) => <>{children}</>

// ================================================================ 05 Séries

const SEQ = 'GPGGPPGGGPPPGPG=GGGG'.split('')
const PILL = { x0: P.x + 4, y: P.y + 92, step: 41.4, size: 34 }

function F5({ b }: CardProps) {
  const lineP = prog(b, DRAW_AT, 1.3, (t) => t * (2 - t))
  const lx = PILL.x0 + lineP * (SEQ.length - 1) * PILL.step + PILL.size / 2
  const cur = prog(b, 1.5, 0.6, expoOut)
  const rows: { label: string; value: string; color: string; sub?: string; at: number }[] = [
    { label: 'Plus longue série gagnante', value: '9 gains de suite', color: C.gain, at: 2 },
    { label: 'Plus longue série perdante', value: '5 pertes de suite', color: C.loss, at: 2.25 },
    { label: 'Moyenne après 2 pertes', value: rMul(-0.4), color: C.loss, sub: `autres trades : ${rMul(0.51)}`, at: 2.5 },
    { label: 'Taille après une perte', value: '+23 %', color: C.warn, sub: 'exposition vs trade précédent', at: 2.75 },
  ]
  return (
    <GlassCard w={880} h={600}>
      <CardTitle right={<Pill style={pop(b, 1)}>20 derniers trades</Pill>}>Séries</CardTitle>
      {/* Le trait lumineux relie les trades, qui s'allument à son passage. */}
      <svg width={880} height={600} style={{ position: 'absolute', left: -P.x, top: -P.y, overflow: 'visible' }}>
        <line x1={PILL.x0} x2={lx} y1={PILL.y + PILL.size / 2} y2={PILL.y + PILL.size / 2} stroke="url(#f5g)" strokeWidth={2} style={{ filter: 'drop-shadow(0 0 6px rgba(139,127,232,.9))' }} />
        <defs>
          <linearGradient id="f5g" gradientUnits="userSpaceOnUse" x1={PILL.x0} x2={PILL.x0 + 800} y1="0" y2="0">
            <stop offset="0" stopColor="#4A5FD9" />
            <stop offset="1" stopColor="#8B7FE8" />
          </linearGradient>
        </defs>
      </svg>
      {SEQ.map((r, i) => {
        const x = PILL.x0 + i * PILL.step
        const on = clamp01((lx - x - 4) / 30)
        const s = on > 0 ? spring(b, DRAW_AT + (i / (SEQ.length - 1)) * 1.3 * 0.6, { freq: 2.4, damping: 0.5 }) : 0
        const t = r === 'G' ? { bg: C.gainBg, fg: C.gain } : r === 'P' ? { bg: C.lossBg, fg: C.loss } : { bg: C.neutralBg, fg: C.neutral }
        const current = i >= 16
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x - P.x,
              top: PILL.y - P.y,
              width: PILL.size,
              height: PILL.size,
              borderRadius: R.sm,
              background: t.bg,
              color: t.fg,
              display: 'grid',
              placeItems: 'center',
              fontSize: 14,
              fontWeight: 700,
              opacity: on,
              transform: `scale(${0.4 + 0.6 * s})`,
              boxShadow: current && cur > 0 ? `0 0 0 ${2 * cur}px rgba(95,203,158,.7), 0 0 ${18 * cur}px rgba(95,203,158,.5)` : undefined,
            }}
          >
            {r === '=' ? '=' : r}
          </div>
        )
      })}
      <div style={{ position: 'absolute', left: PILL.x0 - P.x + 16 * PILL.step, top: PILL.y - P.y + 46, fontSize: 13.5, fontWeight: 600, color: C.gain, opacity: cur, whiteSpace: 'nowrap', transform: `translateX(-40px)` }}>
        Série en cours : 4 gains de suite
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 168 }}>
        {rows.map((r, i) => (
          <Row key={r.label} style={{ height: 62, borderBottom: i < 3 ? `1px solid ${C.hairline}` : undefined, ...pop(b, r.at) }}>
            <div>
              <div style={{ fontSize: 16, color: C.tx }}>{r.label}</div>
              {r.sub && <div style={{ fontSize: 12.5, color: C.tx3, marginTop: 2 }}>{r.sub}</div>}
            </div>
            <b style={{ fontSize: 18, fontWeight: 600, color: r.color }}>{r.value}</b>
          </Row>
        ))}
      </div>
      <Notice tone="warn" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, ...pop(b, 3.5) }}>
        <Icon name="info" size={18} />
        <span>
          Après 2 pertes de suite, ton espérance était plus basse de <b>0,91 R</b>.
        </span>
      </Notice>
    </GlassCard>
  )
}

// ================================================================ 06 Frais et durée de détention

const F6C = { x0: P.x, x1: P.x + 832, base: P.y + 364, h: 176 }
const f6Pts = (net: boolean) => {
  const pts: [number, number][] = []
  for (let i = 0; i <= 100; i++) {
    const t = i / 100
    // Brut = net + frais cumulés (les frais croissent avec le nombre de trades).
    const gross = equityAt(t) + (1284.6 / 12480) * t
    const v = net ? equityAt(t) : gross
    pts.push([F6C.x0 + (F6C.x1 - F6C.x0) * t, F6C.base - (v / 1.13) * F6C.h])
  }
  return pts
}
const F6_GROSS = f6Pts(false)
const F6_NET = f6Pts(true)

function F6({ b }: CardProps) {
  const draw = prog(b, DRAW_AT, 1.3, signature)
  const g = partial(F6_GROSS, draw)
  const n = partial(F6_NET, prog(b, DRAW_AT + 0.25, 1.3, signature))
  const gap = n.pts.length > 2 ? `${smoothPath(g.pts.slice(0, n.pts.length))}L${[...n.pts].reverse().map((p) => `${p[0]} ${p[1]}`).join('L')}Z` : ''
  const stats = [
    { label: 'Frais cumulés', value: money(count(b, 1.25, 1284.6, 1.2), 2, false), at: 1.25 },
    { label: 'Part du P&L brut', value: `${num(count(b, 1.5, 9.3, 1), 1)} %`, at: 1.5 },
    { label: 'Frais par trade', value: money(count(b, 1.75, 7.06, 1), 2, false), at: 1.75 },
  ]
  const win = prog(b, 2.5, 1, quintOut)
  const loss = prog(b, 2.75, 1.2, quintOut)
  return (
    <GlassCard w={880} h={600}>
      <CardTitle right={<Pill style={pop(b, 1)}>182 trades</Pill>}>Frais et durée de détention</CardTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {stats.map((s) => (
          <Inner key={s.label} style={{ padding: '10px 16px', ...pop(b, s.at) }}>
            <div style={{ fontSize: 13, color: C.tx2 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 600, marginTop: 2 }}>{s.value}</div>
          </Inner>
        ))}
      </div>
      <svg width={880} height={600} style={{ position: 'absolute', left: -P.x, top: -P.y, overflow: 'visible' }}>
        {gap && <path d={gap} fill="rgba(217,168,90,.16)" />}
        {n.pts.length > 1 && <path d={smoothPath(n.pts)} fill="none" stroke={C.gain} strokeWidth={2.2} />}
      </svg>
      <div style={{ position: 'absolute', left: 0, top: 112, display: 'flex', gap: 24, fontSize: 13.5, fontWeight: 600, ...pop(b, 2) }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.txAccent }}>
          <span style={{ width: 18, height: 3, borderRadius: 2, background: GRAD }} />
          Brut {money(13764.6)}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.gain }}>
          <span style={{ width: 18, height: 3, borderRadius: 2, background: C.gain }} />
          Net {money(12480)}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#F0CE8E' }}>
          <span style={{ width: 14, height: 10, borderRadius: 3, background: 'rgba(217,168,90,.35)' }} />
          Frais {money(-1284.6)}
        </span>
      </div>
      <div style={{ position: 'absolute', left: -P.x, top: -P.y }}>
        {g.pts.length > 1 && <PulseLine d={smoothPath(g.pts)} width={2.4} glow={0.7} head={draw < 1 ? g.head : null} headSize={0.8} gradX={[F6C.x0, F6C.x1]} viewW={880} viewH={600} core={0.5} />}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 384 }}>
        <Caption style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="clock" size={14} /> Durée moyenne de détention
        </Caption>
        {[
          { label: 'Gagnants', value: '42 min', w: (42 / 78) * win, color: C.gain, o: win },
          { label: 'Perdants', value: '1 h 18 min', w: loss, color: C.loss, o: loss },
        ].map((r) => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, opacity: clamp01(r.o * 4) }}>
            <span style={{ width: 84, fontSize: 14, color: C.tx2 }}>{r.label}</span>
            <div style={{ flex: 1, height: 12, borderRadius: 6, background: 'rgba(255,255,255,.06)' }}>
              <div style={{ height: 12, borderRadius: 6, width: `${r.w * 100}%`, background: r.color, opacity: 0.85 }} />
            </div>
            <b style={{ width: 104, textAlign: 'right', fontSize: 15, fontWeight: 600, color: r.color }}>{r.value}</b>
          </div>
        ))}
        <div style={{ fontSize: 13.5, color: C.tx2, marginTop: 12, ...pop(b, 3) }}>Tes perdants restent en moyenne 1,9 × plus longtemps en position.</div>
      </div>
    </GlassCard>
  )
}

// ================================================================ définitions

export const CARDS = {
  f1: { w: 880, h: 600, entry: f1Pts[0], exit: f1Pts[f1Pts.length - 1], Card: F1 },
  f2: { w: 880, h: 600, entry: [RING.cx, RING.cy - RING.r], exit: [RING.cx + RING.r, RING.cy], Card: F2 },
  f3: { w: 880, h: 600, entry: [P.x, P.y + 53], exit: [P.x + 832, P.y + 53], Card: F3 },
  f4: { w: DDW.w, h: DDW.h, entry: [DDW.x0, DDW.top], exit: [DDW.x1, DDW.top - DD[DD.length - 1] * DDW.scale], Card: DrawdownCard },
  f5: { w: 880, h: 600, entry: [PILL.x0, PILL.y + PILL.size / 2], exit: [PILL.x0 + 19 * PILL.step + PILL.size, PILL.y + PILL.size / 2], Card: F5 },
  f6: { w: 880, h: 600, entry: F6_GROSS[0], exit: F6_GROSS[100], Card: F6 },
} satisfies Record<string, CardDef>

export { HeatmapCard }
