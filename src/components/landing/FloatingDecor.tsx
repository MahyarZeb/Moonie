import { cn } from '@/lib/utils/cn';

interface Item {
  emoji: string;
  left: string;
  top: string;
  size: string;
  delay: string;
  kind: 'float' | 'twinkle';
}

// A fixed list keeps server and client markup identical. Reduced motion is handled in globals.css.
const ITEMS: Item[] = [
  { emoji: '💖', left: '6%', top: '14%', size: 'text-3xl', delay: '0s', kind: 'float' },
  { emoji: '⭐', left: '16%', top: '62%', size: 'text-2xl', delay: '1.2s', kind: 'twinkle' },
  { emoji: '✨', left: '28%', top: '8%', size: 'text-2xl', delay: '0.6s', kind: 'twinkle' },
  { emoji: '☁️', left: '38%', top: '78%', size: 'text-5xl', delay: '2s', kind: 'float' },
  { emoji: '🌙', left: '90%', top: '10%', size: 'text-4xl', delay: '0.3s', kind: 'float' },
  { emoji: '✨', left: '78%', top: '30%', size: 'text-xl', delay: '1.8s', kind: 'twinkle' },
  { emoji: '💜', left: '92%', top: '58%', size: 'text-3xl', delay: '2.4s', kind: 'float' },
  { emoji: '⭐', left: '66%', top: '8%', size: 'text-xl', delay: '0.9s', kind: 'twinkle' },
  { emoji: '🫧', left: '52%', top: '88%', size: 'text-3xl', delay: '1.5s', kind: 'float' },
  { emoji: '💫', left: '4%', top: '84%', size: 'text-2xl', delay: '0.4s', kind: 'twinkle' },
  { emoji: '🎀', left: '84%', top: '84%', size: 'text-3xl', delay: '2.8s', kind: 'float' },
  { emoji: '☁️', left: '70%', top: '70%', size: 'text-4xl', delay: '3.2s', kind: 'float' },
  { emoji: '✨', left: '46%', top: '4%', size: 'text-lg', delay: '2.2s', kind: 'twinkle' },
  { emoji: '💖', left: '24%', top: '40%', size: 'text-xl', delay: '3.6s', kind: 'twinkle' },
];

/** Decorative hearts, stars and sparkles drifting behind the hero. */
export function FloatingDecor({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 -z-0 overflow-hidden', className)}>
      {ITEMS.map((item, i) => (
        <span
          key={i}
          className={cn(
            'absolute select-none opacity-70',
            item.size,
            item.kind === 'float' ? 'animate-float' : 'animate-twinkle',
          )}
          style={{ left: item.left, top: item.top, animationDelay: item.delay }}
        >
          {item.emoji}
        </span>
      ))}
    </div>
  );
}
