/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        devanagari: ['"Noto Sans Devanagari"', 'Inter', 'sans-serif'],
      },
      colors: {
        // Core brand — deep agrarian green / soil tones
        farm: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
          950: '#052e16',
        },
        // Risk severity scale used across telemetry, pest forecast, GIS heatmaps
        risk: {
          low: '#22c55e',
          moderate: '#eab308',
          high: '#f97316',
          severe: '#dc2626',
          critical: '#7f1d1d',
        },
        // Slate-based dark UI surface for dashboards
        surface: {
          50: '#f8fafc',
          100: '#f1f5f9',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
      },
      boxShadow: {
        glow: '0 0 20px rgba(34, 197, 94, 0.35)',
        'glow-red': '0 0 20px rgba(220, 38, 38, 0.35)',
      },
      keyframes: {
        pulseRing: {
          '0%': { transform: 'scale(0.9)', opacity: '0.8' },
          '70%': { transform: 'scale(1.6)', opacity: '0' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
      },
      animation: {
        'pulse-ring': 'pulseRing 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        scanline: 'scanline 2.2s linear infinite',
      },
    },
  },
  plugins: [],
};
