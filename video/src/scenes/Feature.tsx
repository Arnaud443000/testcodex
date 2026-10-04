import { AbsoluteFill } from 'remotion'
import { Aurora } from '../fx/Aurora'
import { Layer3D, Stage3D, type Cam } from '../fx/Stage3D'
import { clamp01, expoIn, expoOut, quintInOut, sineInOut } from '../lib/ease'
import { mix, prog, spring, useLayout, useLocalBeat } from '../lib/time'
import { PulseLine } from '../ui/PulseLine'
import { MaskText } from '../ui/Text'
import { C, GLASS } from '../theme'
import { FEATURE_EXIT, SCENES, type FeatureId } from '../timeline'
import { CARDS, DRAW_AT, HEAT_H, HEAT_W, HeatmapCard } from './cards'

type Copy = { caption: string; title: string[]; desc: string }

const COPY: Record<FeatureId, Copy> = {
  f1: { caption: 'Résumé de période', title: ['Ta période,', 'en un coup d’œil.'], desc: 'Taux de réussite, espérance en R, drawdown : tout est calculé depuis tes trades.' },
  f2: { caption: 'Discipline', title: ['Ta discipline,', 'notée sur 100.'], desc: 'Plan suivi, règles personnelles, checklist : chaque trade reçoit un score, et tu vois où il se perd.' },
  f3: { caption: 'Erreurs récurrentes', title: ['Tes erreurs', 'ont un prix.'], desc: 'Pulse additionne ce que te coûte chaque erreur et la classe. Un clic, et tu revois les trades concernés.' },
  f4: { caption: 'Risque', title: ['Repère la zone', 'de danger.'], desc: 'Drawdown, risque par trade, heatmap jour × heure : tes heures fragiles sautent aux yeux.' },
  f5: { caption: 'Séries', title: ['Tes séries,', 'décodées.'], desc: 'Séries gagnantes et perdantes, résultat après 2 pertes, taille après une perte : tes réflexes, chiffrés.' },
  f6: { caption: 'Frais et durée de détention', title: ['Ce que te coûtent', 'tes frais.'], desc: 'Frais cumulés, part du P&L brut, temps passé en position par les gagnants et les perdants.' },
}

const ORDER: FeatureId[] = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6']

/** Mouvement de caméra propre à chaque plan (t = 0 → 1 sur la durée du plan). */
function camera(id: FeatureId, t: number, b: number): Cam {
  const e = sineInOut(t)
  switch (id) {
    case 'f1': // travelling avant + légère orbite
      return { z: mix(-40, 110, e), ry: mix(-3, 2.5, e), dof: 0.018 }
    case 'f2': // orbite de gauche à droite
      return { ry: mix(7, -4, e), z: 40, dof: 0.018 }
    case 'f3': // plongée lente
      return { rx: mix(7, 1, e), y: mix(-50, 10, e), z: 30, dof: 0.018 }
    case 'f4': {
      // bascule de mise au point : du drawdown (fond) à la heatmap (avant-plan)
      const f = quintInOut(prog(b, 2.6, 0.9))
      return { z: mix(0, 70, e), ry: mix(-2, 2, e), focus: mix(-220, 160, f), dof: 0.03 }
    }
    case 'f5': // travelling latéral
      return { x: mix(-80, 60, e), z: 50, dof: 0.018 }
    case 'f6': // recul
      return { z: mix(130, -30, e), dof: 0.018 }
  }
}

/** Temps 25–60 : un super-pouvoir par plan, la ligne lumineuse fait le raccord. */
export function Feature({ id }: { id: FeatureId }) {
  const b = useLocalBeat()
  const { W, vertical } = useLayout()
  const [s, e] = SCENES[id]
  const len = e - s
  const def = CARDS[id]
  const copy = COPY[id]
  const n = ORDER.indexOf(id) + 1

  // Carte principale : arrive du fond en ressort (léger dépassement), tournée vers le texte.
  const base = vertical ? { x: 0, y: id === 'f4' ? 180 : 340, ry: 0, rx: 4 } : { x: id === 'f4' ? 330 : 296, y: id === 'f4' ? -64 : 8, ry: -11, rx: 2 }
  const sp = spring(b, 0, { freq: 1.15, damping: 0.66 })
  const exitP = expoIn(prog(b, len - FEATURE_EXIT, FEATURE_EXIT))
  const cardZ = (id === 'f4' ? -220 : 0) + mix(-620, 0, sp) + 60 * exitP
  const card = {
    x: base.x + (1 - sp) * (vertical ? 120 : 260),
    y: base.y,
    z: cardZ,
    ry: mix(-36, base.ry, sp),
    rx: base.rx,
  }

  // Trait d'entrée (raccord avec le plan précédent) et de sortie (vers le suivant), dans le plan de la carte.
  const inHead = mix(def.entry[0] - 420, def.entry[0], expoOut(prog(b, 0, DRAW_AT)))
  const inTail = Math.max(-1700, inHead - 1100 * (1 - prog(b, DRAW_AT, 0.35, expoOut)))
  const outHead = mix(def.exit[0], def.exit[0] + 2600, exitP)
  const outTail = Math.max(def.exit[0], outHead - 900)

  const raw = camera(id, clamp01(b / len), b)
  // En vertical, la carte occupe presque toute la largeur : mouvements latéraux réduits.
  const cam = vertical ? { ...raw, x: (raw.x ?? 0) * 0.25, ry: (raw.ry ?? 0) * 0.4 } : raw
  const scale = vertical ? 1 : 1.1
  const textLeft = vertical ? 96 : 160
  const textTop = vertical ? 176 : 336

  return (
    <AbsoluteFill>
      <Aurora intensity={0.92} />
      <Stage3D cam={cam} perspective={vertical ? 2200 : 2000}>
        {/* Plaques de verre floues en arrière-plan : profondeur. */}
        <Layer3D w={520} h={340} x={vertical ? -420 : -900} y={vertical ? 900 : 520} z={-1100} ry={14} extraBlur={12} opacity={0.32}>
          <div style={{ width: '100%', height: '100%', borderRadius: 24, background: GLASS, border: `1px solid ${C.glassBorder}` }} />
        </Layer3D>
        <Layer3D w={420} h={280} x={vertical ? 460 : 1100} y={vertical ? -560 : -480} z={-1100} ry={-16} extraBlur={12} opacity={0.32}>
          <div style={{ width: '100%', height: '100%', borderRadius: 24, background: GLASS, border: `1px solid ${C.glassBorder}` }} />
        </Layer3D>
        <Layer3D w={def.w} h={def.h} x={card.x} y={card.y} z={card.z} rx={card.rx} ry={card.ry} scale={scale} opacity={0.45 + 0.55 * clamp01(b * 4)} dofScale={id === 'f4' ? 0.15 + 0.85 * prog(b, 1.8, 0.8) : 0.15}>
          <def.Card b={b} />
          {/* Reflet qui balaie le verre quand la carte se pose. */}
          <div style={{ position: 'absolute', inset: 0, borderRadius: 24, overflow: 'hidden', pointerEvents: 'none' }}>
            <div
              style={{
                position: 'absolute',
                top: -def.h * 0.5,
                bottom: -def.h * 0.5,
                width: 220,
                left: mix(-400, def.w + 200, prog(b, 0.7, 1.3, sineInOut)),
                transform: 'rotate(18deg)',
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.07), transparent)',
              }}
            />
          </div>
          <div style={{ position: 'absolute', left: 0, top: 0 }}>
            {b < DRAW_AT + 0.4 && (
              <PulseLine d={`M${inTail} ${def.entry[1]}L${inHead} ${def.entry[1]}`} width={3} glow={1.2} head={[inHead, def.entry[1]]} headSize={1} gradX={[inTail, inHead]} viewW={def.w} viewH={def.h} opacity={1 - prog(b, DRAW_AT + 0.1, 0.3)} />
            )}
            {exitP > 0 && (
              <PulseLine d={`M${outTail} ${def.exit[1]}L${outHead} ${def.exit[1]}`} width={3} glow={1.2} head={[outHead, def.exit[1]]} headSize={1} gradX={[outTail, outHead]} viewW={def.w} viewH={def.h} />
            )}
          </div>
        </Layer3D>
        {id === 'f4' && (
          <Layer3D
            w={HEAT_W}
            h={HEAT_H}
            x={vertical ? 0 : 150 + (1 - spring(b, 2.4, { freq: 1.2, damping: 0.7 })) * 200}
            y={vertical ? 650 : 200}
            z={160 - (1 - spring(b, 2.4, { freq: 1.2, damping: 0.7 })) * 500}
            ry={vertical ? 0 : -8}
            rx={vertical ? 4 : 2}
            scale={scale}
            opacity={clamp01((b - 2.4) * 4)}
          >
            <HeatmapCard b={b} />
          </Layer3D>
        )}
      </Stage3D>

      {/* Éclair d'exposition sur la coupe : la coupe frappe sur le temps. */}
      <AbsoluteFill style={{ background: '#A79DF2', opacity: 0.1 * Math.exp(-b * 10), mixBlendMode: 'screen', pointerEvents: 'none' }} />
      {/* Texte sur le tiers gauche (au-dessus en vertical). */}
      <div style={{ position: 'absolute', left: textLeft, top: textTop, width: vertical ? W - 2 * textLeft : 560 }}>
        <MaskText
          text={`${String(n).padStart(2, '0')} / 06 · ${copy.caption}`}
          b={b}
          at={0.3}
          stagger={0.03}
          dur={0.7}
          style={{ fontSize: vertical ? 22 : 16, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.txAccent }}
        />
        <MaskText
          text={copy.title}
          b={b}
          at={0.45}
          stagger={0.06}
          dur={0.9}
          style={{ marginTop: vertical ? 20 : 16, fontSize: vertical ? 72 : 60, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.08 }}
        />
        <MaskText
          text={copy.desc}
          b={b}
          at={0.95}
          stagger={0.015}
          dur={0.8}
          style={{ marginTop: vertical ? 24 : 24, fontSize: vertical ? 30 : 22, lineHeight: 1.5, color: C.tx2, maxWidth: vertical ? 860 : 480 }}
        />
      </div>
    </AbsoluteFill>
  )
}
