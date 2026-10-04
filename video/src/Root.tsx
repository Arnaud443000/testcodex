import { loadFont } from '@remotion/fonts'
import { Composition, staticFile } from 'remotion'
import { Film } from './Film'
import { DURATION_SEC } from './timeline'

// Inter variable embarquée dans l'app (src/assets/fonts/inter.woff2), sans réseau.
loadFont({ family: 'Inter', url: staticFile('fonts/inter.woff2'), weight: '100 900' })

type Props = { fps: number }

/**
 * Deux compositions, conçues en 1920×1080 et 1080×1920. Le master 4K 60 i/s se rend avec
 * --scale=2 --props='{"fps":60}' : toute l'animation est exprimée en temps musicaux.
 */
export function Root() {
  const meta = ({ props }: { props: Props }) => ({ fps: props.fps, durationInFrames: Math.round(DURATION_SEC * props.fps) })
  return (
    <>
      <Composition id="Pulse" component={Film} width={1920} height={1080} fps={30} durationInFrames={1350} defaultProps={{ fps: 30 }} calculateMetadata={meta} />
      <Composition id="PulseVertical" component={Film} width={1080} height={1920} fps={30} durationInFrames={1350} defaultProps={{ fps: 30 }} calculateMetadata={meta} />
    </>
  )
}
