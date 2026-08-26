/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0B0E27',
        surface: '#1E2347',
        primary: '#4A5FD9',
        accent: '#8B7FE8',
        cream: '#F0EDE4',
        success: '#6FA88A',
        danger: '#D96659',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
