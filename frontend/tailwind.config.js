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
        'carbon-bg': '#09090B',
        'carbon-surface': '#18181B',
        'carbon-container': '#1C1C1F',
        'carbon-subtle': '#27272A',
        'carbon-border': '#27272A',
        'carbon-border-light': '#3F3F46',
        'flight-amber': '#D97706',
        'flight-amber-dim': '#B45309',
        'telemetry-green': '#10B981',
        'telemetry-cyan': '#A1A1AA',
        'phosphor-teal': '#10B981',
        'paper-white': '#FAFAFA',
        'alert-red': '#EF4444',
      },
      fontFamily: {
        headline: ['IBM Plex Sans', 'Inter', 'sans-serif'],
        mono: ['IBM Plex Mono', 'JetBrains Mono', 'monospace'],
        body: ['IBM Plex Sans', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
