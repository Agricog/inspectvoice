import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /* InspectVoice — Theme-aware colours via CSS custom properties */
        iv: {
          bg: 'rgb(var(--iv-bg) / <alpha-value>)',
          surface: 'rgb(var(--iv-surface) / <alpha-value>)',
          'surface-2': 'rgb(var(--iv-surface-2) / <alpha-value>)',
          'surface-3': 'rgb(var(--iv-surface-3) / <alpha-value>)',
          border: 'rgb(var(--iv-border) / <alpha-value>)',
          'border-light': 'rgb(var(--iv-border-light) / <alpha-value>)',
          text: 'rgb(var(--iv-text) / <alpha-value>)',
          muted: 'rgb(var(--iv-muted) / <alpha-value>)',
          'muted-2': 'rgb(var(--iv-muted-2) / <alpha-value>)',
          accent: 'rgb(var(--iv-accent) / <alpha-value>)',
          'accent-hover': 'rgb(var(--iv-accent-hover) / <alpha-value>)',
          'accent-muted': 'rgb(var(--iv-accent) / 0.1)',
          blue: 'rgb(var(--iv-blue) / <alpha-value>)',
          'blue-hover': 'rgb(var(--iv-blue-hover) / <alpha-value>)',
          'blue-muted': 'rgb(var(--iv-blue) / 0.1)',
        },
        /* Risk rating colours — fixed across themes for safety compliance */
        risk: {
          'very-high': '#EF4444',
          high: '#F97316',
          medium: '#EAB308',
          low: '#22C55E',
        },
        /* Condition colours — fixed across themes */
        condition: {
          good: '#22C55E',
          fair: '#EAB308',
          poor: '#F97316',
          dangerous: '#EF4444',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      borderRadius: {
        DEFAULT: '0.5rem',
      },
      boxShadow: {
        'iv': '0 1px 3px 0 rgb(var(--iv-shadow) / 0.1), 0 1px 2px -1px rgb(var(--iv-shadow) / 0.1)',
        'iv-lg': '0 10px 15px -3px rgb(var(--iv-shadow) / 0.15), 0 4px 6px -4px rgb(var(--iv-shadow) / 0.15)',
        'iv-glow': '0 0 20px rgba(34, 197, 94, 0.15)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
