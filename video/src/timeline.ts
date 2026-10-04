/**
 * Timeline unique du film : la vidéo ET l'audio (scripts/audio.ts) lisent ces temps.
 * Tout est exprimé en temps musicaux (beats) à 100 BPM ; jamais en images, pour que le
 * même film se rende à 30 ou 60 i/s. Aucun import React ici (lu aussi par Node).
 */

export const BPM = 100
/** Durée d'un temps, en secondes (0,6 s). */
export const BEAT = 60 / BPM
export const TOTAL_BEATS = 75
export const DURATION_SEC = TOTAL_BEATS * BEAT // 45 s

/** Image (arrondie) à laquelle tombe un temps. 30 i/s : 18 images par temps ; 60 i/s : 36. */
export const beatToFrame = (beat: number, fps: number) => Math.round(beat * BEAT * fps)
export const frameToBeat = (frame: number, fps: number) => frame / fps / BEAT
export const beatToSec = (beat: number) => beat * BEAT

export type SceneId = 'intro' | 'chaos' | 'reveal' | 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6' | 'local' | 'outro'

/** Scènes : [début, fin) en temps. */
export const SCENES: Record<SceneId, readonly [number, number]> = {
  intro: [0, 8],
  chaos: [8, 20],
  reveal: [20, 25],
  f1: [25, 31],
  f2: [31, 37],
  f3: [37, 43],
  f4: [43, 49],
  f5: [49, 55],
  f6: [55, 60],
  local: [60, 68],
  outro: [68, 75],
}

export const FEATURE_IDS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'] as const
export type FeatureId = (typeof FEATURE_IDS)[number]

// ---------------------------------------------------------------- Ouverture

/** Battements cardiaques de l'ouverture (le premier embrase le point lumineux). */
export const INTRO_HEARTBEATS = [2, 4, 5, 6, 7] as const
/** Le point lumineux apparaît, la ligne part au temps 3. */
export const INTRO = { dotOn: 0.75, lineStart: 3, textStart: 4, shakeStart: 7.25 } as const

// ---------------------------------------------------------------- Chaos

export type ChaosKind =
  | 'candles'
  | 'notifs'
  | 'pnlFlip'
  | 'fomo'
  | 'revenge'
  | 'ticket'
  | 'size'
  | 'clock'
  | 'stopMoved'
  | 'overtrade'
  | 'candlesUp'
  | 'bpm'
  | 'fragment'
  | 'flash'

export type ChaosShot = { start: number; end: number; kind: ChaosKind; text?: string; tone?: 'gain' | 'loss' | 'warn' | 'white' }

function shots(start: number, length: number, list: Omit<ChaosShot, 'start' | 'end'>[]): ChaosShot[] {
  return list.map((s, i) => ({ ...s, start: start + i * length, end: start + (i + 1) * length }))
}

/** Plans du chaos : coupes d'un temps, puis 1/2, 1/4 et 1/8 de temps ; noir sec au temps 19. */
export const CHAOS_SHOTS: ChaosShot[] = [
  ...shots(8, 1, [{ kind: 'candles' }, { kind: 'notifs' }, { kind: 'pnlFlip' }, { kind: 'fomo' }]),
  ...shots(12, 0.5, [
    { kind: 'revenge' },
    { kind: 'ticket' },
    { kind: 'size' },
    { kind: 'clock' },
    { kind: 'stopMoved' },
    { kind: 'overtrade' },
    { kind: 'candlesUp' },
    { kind: 'bpm' },
  ]),
  ...shots(16, 0.25, [
    { kind: 'fragment', text: '−3 460,00 €', tone: 'loss' },
    { kind: 'fragment', text: 'VENDRE', tone: 'loss' },
    { kind: 'candles' },
    { kind: 'fragment', text: '+840,00 €', tone: 'gain' },
    { kind: 'fragment', text: 'ACHETER', tone: 'gain' },
    { kind: 'notifs' },
    { kind: 'fragment', text: 'FOMO', tone: 'warn' },
    { kind: 'fragment', text: '−1 120,00 €', tone: 'loss' },
  ]),
  ...shots(18, 0.125, [
    { kind: 'flash', text: '−', tone: 'loss' },
    { kind: 'flash', text: '+', tone: 'gain' },
    { kind: 'flash', text: '−2 040 €', tone: 'loss' },
    { kind: 'flash', text: '×3', tone: 'warn' },
    { kind: 'flash', text: '+310 €', tone: 'gain' },
    { kind: 'flash', text: 'STOP', tone: 'loss' },
    { kind: 'flash', text: '−', tone: 'white' },
    { kind: 'flash', text: '!', tone: 'loss' },
  ]),
]
/** Coupe sèche au noir (silence complet jusqu'au temps 20). */
export const CHAOS_BLACK = 19

// ---------------------------------------------------------------- Révélation

export const REVEAL = { heartbeat: 20, curveStart: 20.25, logoStart: 21.5, wordmark: 22.35, tagline: 22.5 } as const

// ---------------------------------------------------------------- Super-pouvoirs

/** Instants (en temps locaux au plan) où une donnée apparaît : un clic d'interface chacun. */
export const FEATURE_CLICKS: Record<FeatureId, number[]> = {
  f1: [1.25, 1.5, 1.75, 2, 2.25, 2.5],
  f2: [1, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25],
  f3: [1, 1.5, 1.75, 2, 2.25, 2.5, 3.5],
  f4: [1.25, 2, 2.4, 3, 3.5],
  f5: [1, 1.5, 2, 2.25, 2.5, 2.75, 3.5],
  f6: [1, 1.25, 1.5, 1.75, 2, 2.5, 2.75, 3],
}
/** La ligne lumineuse quitte le plan à ce temps local (raccord sur le plan suivant). */
export const FEATURE_EXIT = 0.5 // temps avant la fin

// ---------------------------------------------------------------- Local

export const LOCAL = { drawStart: 60, lockClose: 62, line1: 62.5, line2: 64, chips: 65 } as const

// ---------------------------------------------------------------- Final

export const OUTRO = { pullStart: 68, title: 70.5, lastBeat: 72, slogan: [72, 72.25, 72.5] as const, fadeOut: 74.75 } as const

// ---------------------------------------------------------------- Coupes et flou de bougé

/** Toutes les coupes franches (le flou de bougé ne mélange jamais deux plans). */
export const HARD_CUTS: number[] = [
  ...new Set([
    ...Object.values(SCENES).map(([s]) => s),
    ...CHAOS_SHOTS.map((s) => s.start),
    CHAOS_BLACK,
  ]),
].sort((a, b) => a - b)

/**
 * Nombre de sous-images de flou de bougé selon le moment : élevé là où ça bouge vite
 * (chaos, entrées de cartes, recul final), 1 (aucun flou) sur les plans posés.
 */
export function blurSamplesAt(beat: number): number {
  const inRange = (a: number, b: number) => beat >= a && beat < b
  if (inRange(8, 19)) return 5
  if (inRange(20, 22.75)) return 4 // courbe et logo
  for (const id of FEATURE_IDS) {
    const [s, e] = SCENES[id]
    if (inRange(s, s + 1.25)) return 5 // entrée de la carte (ressort)
    if (inRange(e - FEATURE_EXIT, e)) return 5 // sortie sur la ligne
  }
  if (inRange(60, 62.5)) return 3
  if (inRange(68, 72.5)) return 4
  return 1
}

// ---------------------------------------------------------------- Repères audio

export type Cue =
  | { type: 'heart'; beat: number; gain?: number }
  | { type: 'riser'; beat: number; length: number; gain?: number }
  | { type: 'whoosh'; beat: number; gain?: number; pan?: number }
  | { type: 'click'; beat: number; gain?: number; pitch?: number }
  | { type: 'glitch'; beat: number; gain?: number; seed: number }
  | { type: 'impact'; beat: number; gain?: number }
  | { type: 'lock'; beat: number }
  | { type: 'chime'; beat: number; gain?: number }
  | { type: 'shimmer'; beat: number; length: number }
  | { type: 'silence'; beat: number; length: number }
  | { type: 'hat'; beat: number; gain?: number }

export const CUES: Cue[] = (() => {
  const c: Cue[] = []
  // 1. Ouverture : un tintement très doux quand le point s'allume, puis le premier battement.
  c.push({ type: 'chime', beat: INTRO.dotOn, gain: 0.22 })
  for (const b of INTRO_HEARTBEATS) c.push({ type: 'heart', beat: b, gain: b === 2 ? 1 : 0.85 })
  c.push({ type: 'riser', beat: 6, length: 2, gain: 0.5 })
  // 2. Chaos : coeur qui s'emballe, glitch à chaque coupe, montée continue
  for (let b = 8; b < 12; b++) c.push({ type: 'heart', beat: b, gain: 0.9 })
  for (let b = 12; b < 16; b += 0.5) c.push({ type: 'heart', beat: b, gain: 0.75 })
  for (let b = 16; b < 19; b += 0.5) c.push({ type: 'heart', beat: b, gain: 0.7 })
  CHAOS_SHOTS.forEach((s, i) => c.push({ type: 'glitch', beat: s.start, seed: i + 1, gain: s.start < 12 ? 0.7 : s.start < 16 ? 0.55 : 0.45 }))
  c.push({ type: 'whoosh', beat: 8, gain: 0.8, pan: -0.4 })
  c.push({ type: 'riser', beat: 12, length: 7, gain: 0.85 })
  for (let b = 12; b < 19; b += 0.25) c.push({ type: 'hat', beat: b, gain: b < 16 ? 0.2 : 0.3 })
  c.push({ type: 'silence', beat: CHAOS_BLACK, length: 1 })
  // 3. Révélation
  c.push({ type: 'heart', beat: REVEAL.heartbeat, gain: 1 })
  c.push({ type: 'shimmer', beat: 20.5, length: 4.5 })
  c.push({ type: 'chime', beat: REVEAL.logoStart + 0.75, gain: 0.8 })
  c.push({ type: 'impact', beat: REVEAL.logoStart + 0.75, gain: 0.3 })
  c.push({ type: 'riser', beat: 24, length: 1, gain: 0.45 })
  // 4. Super-pouvoirs : whoosh à chaque coupe, battement toutes les 2 temps, clics de données
  for (const id of FEATURE_IDS) {
    const [s, e] = SCENES[id]
    c.push({ type: 'whoosh', beat: s, gain: 0.75, pan: 0.5 })
    for (let b = s; b < e; b += 2) c.push({ type: 'heart', beat: b, gain: 0.75 })
    FEATURE_CLICKS[id].forEach((o, i) => c.push({ type: 'click', beat: s + o, gain: 0.38, pitch: 1 + (i % 3) * 0.12 }))
    c.push({ type: 'riser', beat: e - 1, length: 1, gain: 0.35 })
  }
  // Pulsation douce en croches (charleston fermé) pour tenir le tempo pendant les super-pouvoirs.
  for (let b = 25; b < 60; b += 0.5) c.push({ type: 'hat', beat: b, gain: b % 1 === 0 ? 0.3 : 0.45 })
  // 5. Local
  c.push({ type: 'whoosh', beat: 60, gain: 0.7, pan: -0.3 })
  c.push({ type: 'heart', beat: 60, gain: 0.6 })
  c.push({ type: 'lock', beat: LOCAL.lockClose })
  c.push({ type: 'heart', beat: 64, gain: 0.5 })
  c.push({ type: 'heart', beat: 66, gain: 0.5 })
  c.push({ type: 'click', beat: LOCAL.chips, gain: 0.4 })
  c.push({ type: 'click', beat: LOCAL.chips + 0.25, gain: 0.4, pitch: 1.12 })
  c.push({ type: 'click', beat: LOCAL.chips + 0.5, gain: 0.4, pitch: 1.24 })
  // 6. Final
  c.push({ type: 'whoosh', beat: 68, gain: 0.7, pan: 0 })
  c.push({ type: 'heart', beat: 68, gain: 0.6 })
  c.push({ type: 'heart', beat: 70, gain: 0.6 })
  c.push({ type: 'riser', beat: 69, length: 3, gain: 0.9 })
  c.push({ type: 'impact', beat: OUTRO.lastBeat, gain: 0.42 })
  c.push({ type: 'heart', beat: OUTRO.lastBeat, gain: 1 })
  for (const b of OUTRO.slogan.slice(1)) c.push({ type: 'click', beat: b, gain: 0.35, pitch: 0.9 })
  c.push({ type: 'heart', beat: 74, gain: 0.35 })
  return c.sort((a, b) => a.beat - b.beat)
})()

/** Accords de la nappe (temps de début, fondamentale en Hz, intervalles en demi-tons). */
export const PAD: { beat: number; length: number; root: number; chord: number[]; gain: number }[] = [
  { beat: 20.25, length: 4.75, root: 73.42, chord: [0, 7, 12, 15, 19], gain: 0.5 }, // ré mineur
  { beat: 25, length: 12, root: 58.27, chord: [0, 7, 11, 14, 16], gain: 0.75 }, // si♭ maj7(9)
  { beat: 37, length: 12, root: 87.31, chord: [0, 7, 12, 16, 19], gain: 0.75 }, // fa
  { beat: 49, length: 11, root: 65.41, chord: [0, 7, 10, 14, 17], gain: 0.75 }, // do sus
  { beat: 60, length: 8, root: 73.42, chord: [0, 7, 12, 14, 15], gain: 0.6 }, // ré mineur (9)
  { beat: 68, length: 4, root: 58.27, chord: [0, 7, 11, 14, 19], gain: 0.5 },
  { beat: 72, length: 3, root: 73.42, chord: [0, 7, 12, 16, 19, 24], gain: 0.6 }, // ré majeur (picardie)
]
