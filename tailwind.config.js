/** Tokens from docs/charte-graphique.md v2.0 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Classes composées à l'exécution (paliers de la heatmap : cal-g1…cal-l3).
  safelist: [{ pattern: /^cal-(g|l)[123]$/ }],
  theme: {
    extend: {
      colors: {
        bg: '#0B0E27',
        'bg-deep': '#080B20',
        blue: '#4A5FD9',
        violet: '#8B7FE8',
        cream: '#F0EDE4',
        tx: '#F5F2EC',
        tx2: '#9AA0C0',
        tx3: '#6B7290',
        'tx-accent': '#A79DF2',
        gain: '#5FCB9E',
        loss: '#F0776B',
        warn: '#D9A85A',
        neutral: '#B9BECF',
      },
      fontFamily: { sans: ['Inter', 'system-ui', '"Segoe UI"', 'sans-serif'] },
      borderRadius: { card: '24px', inner: '16px', md: '14px', sm: '10px' },
      boxShadow: {
        card: '0 20px 50px -24px rgba(0,0,0,.65), inset 0 1px 0 rgba(255,255,255,.10)',
        btn: '0 10px 30px -8px rgba(139,127,232,.85), inset 0 1px 0 rgba(255,255,255,.35)',
      },
    },
  },
  plugins: [],
}
