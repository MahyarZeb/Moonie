import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

type Tone = 'pink' | 'lavender' | 'blue' | 'soft';

const tones: Record<Tone, string> = {
  pink: 'bg-pink/40 text-ink',
  lavender: 'bg-lavender/40 text-ink',
  blue: 'bg-sky/50 text-ink',
  soft: 'bg-surface-2 text-ink-soft',
};

export function Badge({ tone = 'lavender', className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold', tones[tone], className)}
      {...rest}
    />
  );
}
