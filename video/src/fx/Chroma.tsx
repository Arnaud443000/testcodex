import { useId, type ReactNode } from 'react'
import { AbsoluteFill } from 'remotion'

/** Aberration chromatique discrète (rouge et bleu décalés en sens contraire), sur les impacts seulement. */
export function Chroma({ amount, children }: { amount: number; children: ReactNode }) {
  const id = useId().replace(/:/g, '')
  if (amount < 0.3) return <AbsoluteFill>{children}</AbsoluteFill>
  return (
    <AbsoluteFill>
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <filter id={`ca${id}`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
          <feOffset in="r" dx={amount} dy={amount * 0.25} result="r2" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
          <feOffset in="b" dx={-amount} dy={-amount * 0.25} result="b2" />
          <feBlend mode="screen" in="r2" in2="g" result="rg" />
          <feBlend mode="screen" in="rg" in2="b2" />
        </filter>
      </svg>
      <AbsoluteFill style={{ filter: `url(#ca${id})` }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  )
}
