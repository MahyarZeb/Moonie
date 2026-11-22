'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme/useTheme';
import { IconButton } from './IconButton';

export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  // Before mount the resolved mode is unknown, so a neutral placeholder keeps server and client markup equal.
  if (!resolved) return <IconButton label="Toggle theme" disabled><span className="h-[18px] w-[18px]" /></IconButton>;
  const dark = resolved === 'dark';
  return (
    <IconButton label={dark ? 'Switch to light mode' : 'Switch to midnight mode'} onClick={toggle}>
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </IconButton>
  );
}
