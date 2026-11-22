import type { Config } from 'tailwindcss';

const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        'surface-2': token('surface-2'),
        ink: token('ink'),
        'ink-soft': token('ink-soft'),
        pink: token('pink'),
        lavender: token('lavender'),
        sky: token('blue'),
        purple: token('purple'),
        accent: token('accent'),
        'accent-2': token('accent-2'),
      },
      fontFamily: {
        display: ['var(--font-display)', 'ui-rounded', "'Segoe UI'", 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'ui-rounded', "'Segoe UI'", 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 10px 30px -12px rgb(var(--purple) / 0.45)',
        glow: '0 0 0 4px rgb(var(--accent) / 0.35)',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0) rotate(0deg)' },
          '50%': { transform: 'translateY(-14px) rotate(6deg)' },
        },
        twinkle: {
          '0%, 100%': { opacity: '0.4', transform: 'scale(0.9)' },
          '50%': { opacity: '1', transform: 'scale(1.1)' },
        },
        pop: {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
        twinkle: 'twinkle 3s ease-in-out infinite',
        pop: 'pop 0.25s ease-out both',
      },
    },
  },
  plugins: [],
};

export default config;
