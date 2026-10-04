/**
 * Flare anamorphique (trait horizontal + halo) posé sur une source lumineuse, à la manière
 * des optiques de cinéma. `k` = intensité 0 → 1 ; jamais plus d'un flare à l'écran.
 */
export function Flare({ x, y, k, width = 1100, color = '167,157,242' }: { x: number; y: number; k: number; width?: number; color?: string }) {
  if (k < 0.01) return null
  const w = width * (0.6 + 0.4 * k)
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', mixBlendMode: 'screen' }}>
      <div style={{ position: 'absolute', left: x - w / 2, top: y - 1.5, width: w, height: 3, borderRadius: 3, opacity: k, background: `linear-gradient(90deg, transparent, rgba(${color},.55) 35%, rgba(255,255,255,.95) 50%, rgba(${color},.55) 65%, transparent)` }} />
      <div style={{ position: 'absolute', left: x - w * 0.3, top: y - 10, width: w * 0.6, height: 20, borderRadius: 20, opacity: 0.35 * k, filter: 'blur(8px)', background: `linear-gradient(90deg, transparent, rgba(${color},.8), transparent)` }} />
      <div style={{ position: 'absolute', left: x - 90, top: y - 90, width: 180, height: 180, borderRadius: 999, opacity: 0.5 * k, background: `radial-gradient(circle, rgba(255,255,255,.7), rgba(${color},.25) 35%, transparent 70%)` }} />
    </div>
  )
}

/** Halo volumétrique doux derrière un objet (logo, cadenas). */
export function Halo({ x, y, r, k, color = '139,127,232' }: { x: number; y: number; r: number; k: number; color?: string }) {
  if (k < 0.01) return null
  return <div style={{ position: 'absolute', left: x - r, top: y - r, width: 2 * r, height: 2 * r, borderRadius: 9999, opacity: k, background: `radial-gradient(circle, rgba(${color},.32), rgba(74,95,217,.12) 40%, transparent 70%)`, pointerEvents: 'none' }} />
}
