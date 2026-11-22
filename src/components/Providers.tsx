'use client';

import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/Toast';
import { RoomProvider } from '@/lib/room/RoomProvider';
import { ThemeProvider } from '@/lib/theme/useTheme';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <RoomProvider>{children}</RoomProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
