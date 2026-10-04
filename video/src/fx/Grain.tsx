import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { hash } from '../lib/random'

/** Grain argentique fin : tuile de bruit précalculée, changée et décalée toutes les 2 images (à 30 i/s). */
export function Grain({ opacity = 0.055 }: { opacity?: number }) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const step = Math.floor((frame * 30) / fps / 2)
  const tile = Math.floor(hash(step) * 6)
  const ox = Math.floor(hash(step + 0.5) * 256)
  const oy = Math.floor(hash(step + 0.25) * 256)
  const cols = Math.ceil(width / 256) + 1
  const rows = Math.ceil(height / 256) + 1
  return (
    <AbsoluteFill style={{ mixBlendMode: 'overlay', opacity, pointerEvents: 'none', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: -ox, top: -oy, width: cols * 256, height: rows * 256, display: 'grid', gridTemplateColumns: `repeat(${cols}, 256px)` }}>
        {Array.from({ length: cols * rows }, (_, i) => (
          <Img key={i} src={staticFile(`grain/grain-${tile}.png`)} style={{ width: 256, height: 256, display: 'block' }} />
        ))}
      </div>
    </AbsoluteFill>
  )
}
