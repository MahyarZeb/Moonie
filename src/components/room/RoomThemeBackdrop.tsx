import type { ThemeId } from '@shared/protocol';
import { getRoomTheme } from '@/lib/theme/roomThemes';

const SPOTS = [
  { left: '5%', top: '12%', size: 'text-3xl', delay: '0s' },
  { left: '88%', top: '16%', size: 'text-4xl', delay: '1s' },
  { left: '12%', top: '70%', size: 'text-4xl', delay: '2s' },
  { left: '82%', top: '74%', size: 'text-3xl', delay: '0.5s' },
  { left: '48%', top: '6%', size: 'text-2xl', delay: '1.6s' },
  { left: '60%', top: '90%', size: 'text-2xl', delay: '2.4s' },
];

/** Theme-colored gradient with a few drifting emoji from the room theme's decoration set. */
export function RoomThemeBackdrop({ theme }: { theme?: ThemeId }) {
  const info = getRoomTheme(theme);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="stage-backdrop absolute inset-0 opacity-60" />
      {SPOTS.map((s, i) => (
        <span
          key={i}
          className={`absolute animate-float opacity-60 ${s.size}`}
          style={{ left: s.left, top: s.top, animationDelay: s.delay }}
        >
          {info.decor[i % info.decor.length]}
        </span>
      ))}
    </div>
  );
}
