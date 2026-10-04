import { createContext, useContext, type CSSProperties, type ReactNode } from 'react'
import { AbsoluteFill } from 'remotion'

/**
 * Caméra virtuelle : perspective CSS + monde en preserve-3d. La caméra se déplace (dolly,
 * travelling, orbite) en transformant le monde à l'inverse. La profondeur de champ est
 * simulée par couche (Layer3D) : flou proportionnel à l'écart avec le plan de mise au point.
 */
export type Cam = { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; focus?: number; dof?: number }

const CamCtx = createContext<Required<Cam>>({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, focus: 0, dof: 0 })

export function Stage3D({ cam, perspective = 2000, children }: { cam: Cam; perspective?: number; children: ReactNode }) {
  const c = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, focus: 0, dof: 0, ...cam }
  return (
    <CamCtx.Provider value={c}>
      <AbsoluteFill style={{ perspective, perspectiveOrigin: '50% 50%', overflow: 'hidden' }}>
        <AbsoluteFill
          style={{
            transformStyle: 'preserve-3d',
            transform: `translate3d(${-c.x}px, ${-c.y}px, ${c.z}px) rotateX(${c.rx}deg) rotateY(${c.ry}deg) rotateZ(${c.rz}deg)`,
          }}
        >
          {children}
        </AbsoluteFill>
      </AbsoluteFill>
    </CamCtx.Provider>
  )
}

/** Élément placé dans le monde 3D, centré sur (x, y, z) ; flou de profondeur automatique. */
export function Layer3D({
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
  scale = 1,
  w,
  h,
  opacity = 1,
  extraBlur = 0,
  style,
  children,
}: {
  x?: number
  y?: number
  z?: number
  rx?: number
  ry?: number
  rz?: number
  scale?: number
  w: number
  h: number
  opacity?: number
  extraBlur?: number
  style?: CSSProperties
  children: ReactNode
}) {
  const cam = useContext(CamCtx)
  const blur = Math.min(14, Math.abs(z - cam.focus) * cam.dof) + extraBlur
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: w,
        height: h,
        marginLeft: -w / 2,
        marginTop: -h / 2,
        transformStyle: 'preserve-3d',
        transform: `translate3d(${x}px, ${y}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${scale})`,
        opacity,
        filter: blur > 0.25 ? `blur(${blur.toFixed(2)}px)` : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  )
}
