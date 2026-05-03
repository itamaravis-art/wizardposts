import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'var(--font-heebo)',
          'Heebo',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'sans-serif',
        ],
      },
      colors: {
        // Brand: HSL-based blue scale
        brand: {
          50: 'hsl(214 100% 97%)',
          100: 'hsl(214 95% 93%)',
          200: 'hsl(213 97% 87%)',
          300: 'hsl(212 96% 78%)',
          400: 'hsl(213 94% 68%)',
          500: 'hsl(217 91% 60%)',
          600: 'hsl(221 83% 53%)',
          700: 'hsl(224 76% 45%)',
          800: 'hsl(226 71% 38%)',
          900: 'hsl(224 64% 30%)',
          950: 'hsl(226 57% 21%)',
        },
        // Semantic accents
        success: {
          50: 'hsl(138 76% 97%)',
          100: 'hsl(141 84% 93%)',
          500: 'hsl(142 71% 45%)',
          600: 'hsl(142 76% 36%)',
          700: 'hsl(142 72% 29%)',
        },
        warning: {
          50: 'hsl(48 96% 95%)',
          100: 'hsl(48 96% 89%)',
          500: 'hsl(38 92% 50%)',
          600: 'hsl(32 95% 44%)',
          700: 'hsl(26 90% 37%)',
        },
        danger: {
          50: 'hsl(0 86% 97%)',
          100: 'hsl(0 93% 94%)',
          500: 'hsl(0 84% 60%)',
          600: 'hsl(0 72% 51%)',
          700: 'hsl(0 74% 42%)',
        },
        info: {
          50: 'hsl(204 100% 97%)',
          100: 'hsl(204 94% 94%)',
          500: 'hsl(199 89% 48%)',
          600: 'hsl(200 98% 39%)',
          700: 'hsl(201 96% 32%)',
        },
        // Token-based theme colors (consume CSS vars from globals.css)
        bg: 'hsl(var(--bg) / <alpha-value>)',
        surface: 'hsl(var(--surface) / <alpha-value>)',
        'surface-2': 'hsl(var(--surface-2) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        'border-strong': 'hsl(var(--border-strong) / <alpha-value>)',
        muted: 'hsl(var(--muted) / <alpha-value>)',
        'muted-foreground': 'hsl(var(--muted-foreground) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
      },
      borderRadius: {
        sm: '0.375rem',
        md: '0.5rem',
        lg: '0.625rem',
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card:
          '0 1px 2px 0 hsl(220 40% 10% / 0.04), 0 1px 3px 0 hsl(220 40% 10% / 0.06)',
        elevated:
          '0 4px 6px -2px hsl(220 40% 10% / 0.05), 0 10px 20px -5px hsl(220 40% 10% / 0.08)',
        glow:
          '0 0 0 1px hsl(217 91% 60% / 0.15), 0 4px 16px -2px hsl(217 91% 60% / 0.3)',
        inset: 'inset 0 1px 2px 0 hsl(220 40% 10% / 0.06)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-out': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-end': {
          from: { opacity: '0', transform: 'translateX(-12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'progress-indeterminate': {
          '0%': { left: '-40%' },
          '100%': { left: '100%' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'fade-out': 'fade-out 150ms ease-in',
        'slide-up': 'slide-up 250ms ease-out',
        'slide-down': 'slide-down 250ms ease-out',
        'slide-in-end': 'slide-in-end 250ms ease-out',
        shimmer: 'shimmer 1.5s linear infinite',
        'spin-slow': 'spin-slow 1s linear infinite',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'scale-in': 'scale-in 180ms ease-out',
        'progress-indeterminate': 'progress-indeterminate 1.6s ease-in-out infinite',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
