import type { FC } from 'react'
import { AbsoluteFill, Audio, getStaticFiles, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { Chroma } from './fx/Chroma'
import { Grain } from './fx/Grain'
import { MotionBlur } from './fx/MotionBlur'
import { Vignette } from './fx/Vignette'
import { SceneStartProvider, keys, useBeat } from './lib/time'
import { Chaos } from './scenes/Chaos'
import { Feature } from './scenes/Feature'
import { Intro } from './scenes/Intro'
import { Local } from './scenes/Local'
import { Outro } from './scenes/Outro'
import { Reveal } from './scenes/Reveal'
import { FONT } from './theme'
import { beatToFrame, LOCAL, OUTRO, SCENES, type SceneId } from './timeline'

const SCENE_COMPONENTS: Record<SceneId, FC> = {
  intro: Intro,
  chaos: Chaos,
  reveal: Reveal,
  f1: () => <Feature id="f1" />,
  f2: () => <Feature id="f2" />,
  f3: () => <Feature id="f3" />,
  f4: () => <Feature id="f4" />,
  f5: () => <Feature id="f5" />,
  f6: () => <Feature id="f6" />,
  local: Local,
  outro: Outro,
}

/** Le plan actif à l'image courante (coupes franches sur les temps). */
function Scenes() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const entry = (Object.entries(SCENES) as [SceneId, readonly [number, number]][]).find(
    ([, [s, e]]) => frame >= beatToFrame(s, fps) && frame < beatToFrame(e, fps),
  )
  if (!entry) return <AbsoluteFill style={{ background: '#000' }} />
  const [id, [start]] = entry
  const Comp = SCENE_COMPONENTS[id]
  return (
    <SceneStartProvider value={start}>
      <Comp />
    </SceneStartProvider>
  )
}

/** Aberration chromatique : montée dans le chaos, puis seulement sur les impacts. */
function chromaAt(b: number) {
  if (b >= 16 && b < 19) return b < 18 ? keys(b, [[16, 1.5], [18, 3.5]]) : 7 * (1 - ((b * 8) % 1) * 0.6)
  const impact = (at: number, peak: number) => (b >= at && b < at + 1 ? peak * Math.exp(-(b - at) * 5) : 0)
  return Math.max(impact(8, 4), impact(LOCAL.lockClose, 3.5), impact(OUTRO.lastBeat, 6))
}

export function Film() {
  const b = useBeat()
  const hasAudio = getStaticFiles().some((f) => f.name === 'audio/pulse.wav')
  return (
    <AbsoluteFill style={{ fontFamily: FONT, background: '#000', color: '#F5F2EC', fontVariantNumeric: 'tabular-nums', WebkitFontSmoothing: 'antialiased' }}>
      <Chroma amount={chromaAt(b)}>
        <MotionBlur>
          <Scenes />
        </MotionBlur>
      </Chroma>
      <Vignette />
      <Grain />
      {hasAudio && <Audio src={staticFile('audio/pulse.wav')} />}
    </AbsoluteFill>
  )
}
