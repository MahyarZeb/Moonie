import { Nunito, Quicksand } from 'next/font/google';

// Fetched and self-hosted at build time. The CSS variables fall back to a rounded system stack (see tailwind.config.ts).
export const bodyFont = Nunito({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
  fallback: ['ui-rounded', 'Segoe UI', 'system-ui', 'sans-serif'],
  adjustFontFallback: true,
});

export const displayFont = Quicksand({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['500', '600', '700'],
  fallback: ['ui-rounded', 'Segoe UI', 'system-ui', 'sans-serif'],
  adjustFontFallback: true,
});
