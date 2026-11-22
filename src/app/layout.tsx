import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/Providers';
import { themeScript } from '@/lib/theme/themeScript';
import { bodyFont, displayFont } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'Moonie 🌙 | Watch, play & chill together',
  description:
    'Moonie is a cozy virtual hangout. Watch YouTube together, share your screen, play games and chat in real time. No accounts needed.',
  applicationName: 'Moonie',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fff8ec' },
    { media: '(prefers-color-scheme: dark)', color: '#17142b' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${bodyFont.variable} ${displayFont.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
