/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        'carbon-bg': '#0B0C0E',
        'carbon-surface': '#121417',
        'carbon-container': '#181B20',
        'carbon-subtle': '#1E2228',
        'carbon-border': '#23272F',
        'carbon-border-light': '#2E3440',
        'flight-amber': '#F5A623',
        'flight-amber-dim': '#D9822B',
        'telemetry-cyan': '#00E5FF',
        'phosphor-teal': '#2DD4BF',
        'paper-white': '#F8FAFC',
        'alert-red': '#EF4444',
      },
      fontFamily: {
        headline: ['Space Grotesk', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        body: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
