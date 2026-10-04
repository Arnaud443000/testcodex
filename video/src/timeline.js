// Source unique du rythme : lue par la vidéo (Remotion) ET par la synthèse audio (scripts/audio.mjs).
export const FPS = 60
export const BPM = 100
export const BEAT = (FPS * 60) / BPM // 36 images par temps
export const BEATS_TOTAL = 75
export const TOTAL_FRAMES = BEATS_TOTAL * BEAT // 2700 = 45 s
export const SEC_PER_BEAT = 60 / BPM

// Plans, en temps (chaque coupe tombe sur un temps)
export const SCENES = {
  silence: [0, 8],
  chaos: [8, 20],
  reveal: [20, 25],
  powers: [25, 60],
  local: [60, 68],
  finale: [68, 75],
}

// Six « super-pouvoirs » : 6 temps chacun (3,6 s), le dernier 5 temps
export const POWER_STARTS = [25, 31, 37, 43, 49, 55]
export const POWER_ENDS = [31, 37, 43, 49, 55, 60]

// Coupes du chaos (durées en temps) : de plus en plus rapides jusqu'à la saturation
const durs = [1, 1, 1, 1, ...Array(6).fill(0.5), ...Array(8).fill(0.25), ...Array(12).fill(0.125)]
export const CHAOS_CUTS = (() => {
  const out = []
  let t = SCENES.chaos[0]
  for (const d of durs) {
    out.push({ from: t, to: t + d })
    t += d
  }
  return out // se termine à 19,5 ; 19,5 → 20 = saturation
})()
export const SATURATION_FROM = 19.5
