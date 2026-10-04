/** Tokens de docs/charte-graphique.md v2.0 (les mêmes que tailwind.config.js de l'app). */
export const C = {
  bg: '#0B0E27',
  bgDeep: '#080B20',
  black: '#04050F',
  blue: '#4A5FD9',
  violet: '#8B7FE8',
  cream: '#F0EDE4',
  tx: '#F5F2EC',
  tx2: '#9AA0C0',
  tx3: '#6B7290',
  txAccent: '#A79DF2',
  gain: '#5FCB9E',
  gainBg: '#16302A',
  loss: '#F0776B',
  lossBg: '#3A211E',
  warn: '#D9A85A',
  warnBg: 'rgba(217,168,90,.12)',
  neutral: '#B9BECF',
  neutralBg: '#20233A',
  hairline: 'rgba(255,255,255,.08)',
  glassBorder: 'rgba(255,255,255,.10)',
  control: 'rgba(255,255,255,.05)',
  inner: 'rgba(255,255,255,.04)',
} as const

export const GRAD = 'linear-gradient(135deg,#4A5FD9,#8B7FE8)'
export const GLASS = 'linear-gradient(160deg,rgba(255,255,255,.085),rgba(255,255,255,.03))'

export const R = { sm: 10, md: 14, inner: 16, card: 24, pill: 999 } as const

export const SHADOW = {
  card: '0 20px 50px -24px rgba(0,0,0,.65), inset 0 1px 0 rgba(255,255,255,.10)',
  /** Carte flottante dans l'espace 3D : ombre portée plus longue, même lumière zénithale. */
  float: '0 40px 90px -30px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.02), inset 0 1px 0 rgba(255,255,255,.12)',
  btn: '0 10px 30px -8px rgba(139,127,232,.85), inset 0 1px 0 rgba(255,255,255,.35)',
} as const

/** Lueur de la courbe d'équité (charte 4.3). */
export const GLOW = 'drop-shadow(0 0 8px rgba(139,127,232,.95))'

export const FONT = "'Inter', system-ui, 'Segoe UI', sans-serif"

/** Grille de 8 px. */
export const g = (n: number) => n * 8
