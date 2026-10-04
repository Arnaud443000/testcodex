import { AbsoluteFill } from 'remotion'

export function Vignette({ strength = 0.55 }: { strength?: number }) {
  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        background: `radial-gradient(ellipse 75% 70% at 50% 50%, transparent 55%, rgba(2,3,12,${strength}) 100%)`,
      }}
    />
  )
}
