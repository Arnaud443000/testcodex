export { FPS, BPM, BEAT, TOTAL_FRAMES, SCENES } from './timeline.js'
import { BEAT } from './timeline.js'

/** Tokens de la charte graphique de l'app (docs/charte-graphique.md v2.0). */
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
  loss: '#F0776B',
  warn: '#D9A85A',
  neutral: '#B9BECF',
  grad: 'linear-gradient(135deg,#4A5FD9,#8B7FE8)',
  glass: 'linear-gradient(160deg,rgba(255,255,255,.085),rgba(255,255,255,.03))',
  glassBorder: 'rgba(255,255,255,.10)',
  hairline: 'rgba(255,255,255,.08)',
  control: 'rgba(255,255,255,.05)',
}
export const R = { sm: 10, md: 14, inner: 16, card: 24 }
export const SHADOW_CARD = '0 20px 50px -24px rgba(0,0,0,.65), inset 0 1px 0 rgba(255,255,255,.10)'
export const GRID = 8
export const beatF = (n: number) => n * BEAT
export const FONT = "'Inter', system-ui, 'Segoe UI', sans-serif"
