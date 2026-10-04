import type { CSSProperties, ReactNode } from 'react'
import { C, GLASS, R, SHADOW } from '../theme'

/** Carte en verre de la charte (5.3) : fond verre, bord 10 %, rayon 24, padding 22 × 24. */
export function GlassCard({ w, h, children, style, pad = true }: { w: number; h: number; children: ReactNode; style?: CSSProperties; pad?: boolean }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        boxSizing: 'border-box',
        borderRadius: R.card,
        border: `1px solid ${C.glassBorder}`,
        // Verre de la charte posé sur un fond sombre (pas de backdrop-filter en 3D).
        background: `${GLASS}, rgba(13,17,44,.82)`,
        boxShadow: SHADOW.float,
        padding: pad ? '22px 24px' : 0,
        color: C.tx,
        position: 'relative',
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* Reflet spéculaire en haut de la carte. */}
      <div style={{ position: 'absolute', inset: 0, borderRadius: R.card, background: 'linear-gradient(180deg, rgba(255,255,255,.05), transparent 30%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', height: '100%' }}>{children}</div>
    </div>
  )
}

export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.005em' }}>{children}</div>
      {right}
    </div>
  )
}

export function Caption({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.tx3, ...style }}>{children}</div>
}

const BADGE = {
  gain: { bg: C.gainBg, fg: C.gain },
  loss: { bg: C.lossBg, fg: C.loss },
  warn: { bg: C.warnBg, fg: C.warn },
  neutral: { bg: C.neutralBg, fg: C.neutral },
}

/** Badge de statut (charte 5.7) : pilule 12,5 px / 600 avec point 6 px. */
export function Badge({ tone, children, scale = 1 }: { tone: keyof typeof BADGE; children: ReactNode; scale?: number }) {
  const t = BADGE[tone]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6 * scale,
        borderRadius: R.pill,
        padding: `${4 * scale}px ${12 * scale}px`,
        fontSize: 12.5 * scale,
        fontWeight: 600,
        background: t.bg,
        color: t.fg,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6 * scale, height: 6 * scale, borderRadius: 99, background: 'currentColor' }} />
      {children}
    </span>
  )
}

/** Pilule neutre (« 182 trades »). */
export function Pill({ children, active, style }: { children: ReactNode; active?: boolean; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        borderRadius: R.pill,
        padding: '6px 14px',
        fontSize: 13,
        fontWeight: 500,
        background: active ? 'linear-gradient(135deg, rgba(74,95,217,.38), rgba(139,127,232,.26))' : C.control,
        border: `1px solid ${active ? 'rgba(139,127,232,.6)' : 'rgba(255,255,255,.1)'}`,
        color: active ? '#fff' : C.tx2,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  )
}

/** Bloc interne (rayon 16) des cartes de comparaison. */
export function Inner({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ borderRadius: R.inner, background: C.inner, border: `1px solid ${C.hairline}`, padding: '14px 16px', ...style }}>{children}</div>
}

/** Notice (charte 5.6). */
export function Notice({ tone, children, style }: { tone: 'ok' | 'warn' | 'bad'; children: ReactNode; style?: CSSProperties }) {
  const t = {
    ok: { fg: '#9BE3C4', bg: 'rgba(95,203,158,.10)', bd: 'rgba(95,203,158,.30)' },
    warn: { fg: '#F0CE8E', bg: 'rgba(217,168,90,.12)', bd: 'rgba(217,168,90,.40)' },
    bad: { fg: '#F5A198', bg: 'rgba(240,119,107,.12)', bd: 'rgba(240,119,107,.40)' },
  }[tone]
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', borderRadius: R.inner, padding: '13px 15px', fontSize: 14, lineHeight: 1.4, color: t.fg, background: t.bg, border: `1px solid ${t.bd}`, ...style }}>
      {children}
    </div>
  )
}
