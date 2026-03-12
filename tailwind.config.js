/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './App.tsx', './services/**/*.{ts,tsx}', './server/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        display: ['"Bebas Neue"', '"Space Grotesk"', 'sans-serif'],
      },
      colors: {
        ink: '#07111f',
        brass: '#d4a44e',
        ember: '#ec5b36',
        mint: '#67d3c1',
      },
      boxShadow: {
        aura: '0 20px 70px rgba(4, 9, 24, 0.45)',
      },
    },
  },
  plugins: [],
};
