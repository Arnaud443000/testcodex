import type { CSSProperties, ReactNode } from 'react'
import { signature, expoIn, clamp01 } from '../lib/ease'
import { BEAT } from '../timeline'

/**
 * Texte révélé par masque, mot par mot : chaque mot monte derrière une fenêtre de découpe
 * (signature ease) avec un stagger. `out` : sortie vers le haut (même masque).
 */
export function MaskText({
  text,
  b,
  at,
  stagger = 0.08,
  dur = 0.9,
  out,
  style,
  lineStyle,
  align = 'left',
}: {
  text: string | string[]
  b: number
  at: number
  stagger?: number
  dur?: number
  out?: number
  style?: CSSProperties
  lineStyle?: CSSProperties
  align?: 'left' | 'center' | 'right'
}) {
  const lines = Array.isArray(text) ? text : [text]
  let k = 0
  return (
    <div style={{ textAlign: align, ...style }}>
      {lines.map((line, li) => (
        <div key={li} style={{ display: 'block', ...lineStyle }}>
          {line.split(' ').map((word, wi) => {
            const i = k++
            const p = signature(clamp01((b - at - i * stagger) / dur))
            const o = out === undefined ? 0 : expoIn(clamp01((b - out - i * stagger * 0.5) / 0.5))
            const y = (1 - p) * 105 - o * 105
            return (
              <span key={wi}>
              {wi > 0 ? ' ' : null}
              <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', padding: '0.08em 0.02em 0.14em', margin: '-0.08em -0.02em -0.14em' }}>
                <span style={{ display: 'inline-block', transform: `translateY(${y}%) rotate(${(1 - p) * 4}deg)`, transformOrigin: '0 100%', opacity: p * (1 - o) > 0 ? 1 : 0 }}>
                  {word}
                </span>
              </span>
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** Apparition simple par masque d'un bloc (pour les chiffres et composants). */
export function MaskIn({ b, at, dur = 0.8, children, style }: { b: number; at: number; dur?: number; children: ReactNode; style?: CSSProperties }) {
  const p = signature(clamp01((b - at) / dur))
  return (
    <div style={{ overflow: 'hidden', ...style }}>
      <div style={{ transform: `translateY(${(1 - p) * 100}%)`, opacity: p > 0 ? 1 : 0 }}>{children}</div>
    </div>
  )
}

/** Valeur qui compte de 0 à `to` (ressort de sortie). */
export function count(b: number, at: number, to: number, dur = 1.6) {
  const t = clamp01((b - at) / dur)
  return to * (1 - Math.pow(1 - t, 4))
}

export const secs = (beats: number) => beats * BEAT
