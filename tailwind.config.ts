import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* InspectVoice Dark Theme — Professional inspection platform */
        iv: {
          bg: '#0C0F14',
          surface: '#151920',
          'surface-2': '#1C2029',
          'surface-3': '#232830',
          border: '#2A2F3A',
          'border-light': '#363C4A',
          text: '#E8ECF1',
          muted: '#7A8494',
          'muted-2': '#5A6474',
          accent: '#22C55E',        /* Green — safety/compliance */
          'accent-hover': '#16A34A',
          'accent-muted': '#22C55E1A',
          blue: '#3B82F6',          /* Info/navigation */
          'blue-hover': '#2563EB',
          'blue-muted': '#3B82F61A',
        },
        /* Risk rating colours — BS EN compliant severity scale */
        risk: {
          'very-high': '#EF4444',   /* Red — immediate closure */
          high: '#F97316',          /* Orange — 48hr action */
          medium: '#EAB308',        /* Amber — 1 month */
          low: '#22C55E',           /* Green — routine */
        },
        /* Condition colours */
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
        'iv': '0 1px 3px 0 rgba(0, 0, 0, 0.3), 0 1px 2px -1px rgba(0, 0, 0, 0.3)',
        'iv-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -4px rgba(0, 0, 0, 0.4)',
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
