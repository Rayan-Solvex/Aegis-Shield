/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        aegis: {
          bg: '#000010',
          surface: '#05051a',
          card: '#0a0a2e',
          border: '#1a1a4e',
          cyan: '#00d4ff',
          purple: '#8b5cf6',
          teal: '#06b6d4',
          green: '#10b981',
          red: '#ef4444',
          amber: '#f59e0b',
          muted: '#6b7280',
          text: '#e2e8f0',
          subtext: '#94a3b8',
        },
      },
      backgroundImage: {
        'aegis-gradient': 'linear-gradient(135deg, #00d4ff 0%, #8b5cf6 100%)',
        'card-gradient': 'linear-gradient(135deg, rgba(0,212,255,0.05) 0%, rgba(139,92,246,0.05) 100%)',
        'hero-gradient': 'radial-gradient(ellipse at top, rgba(0,212,255,0.15) 0%, transparent 60%)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 3s linear infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          from: { boxShadow: '0 0 5px rgba(0,212,255,0.3)' },
          to: { boxShadow: '0 0 20px rgba(0,212,255,0.6), 0 0 40px rgba(139,92,246,0.3)' },
        },
      },
    },
  },
  plugins: [],
}
