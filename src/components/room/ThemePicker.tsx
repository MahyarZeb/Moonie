'use client';

import type { ThemeId } from '@shared/protocol';
import { ROOM_THEMES } from '@/lib/theme/roomThemes';
import { cn } from '@/lib/utils/cn';

export function ThemePicker({ value, onChange }: { value: ThemeId; onChange: (id: ThemeId) => void }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-bold">Room theme</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Room theme">
        {ROOM_THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={t.id === value}
            onClick={() => onChange(t.id)}
            className={cn(
              'flex items-center gap-2 rounded-2xl border-2 px-3 py-2 text-left text-sm font-bold transition hover:-translate-y-0.5',
              t.id === value ? 'border-purple bg-lavender/30 shadow-glow' : 'border-transparent bg-surface-2 hover:border-lavender',
            )}
          >
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg"
              style={{ backgroundImage: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }}
            >
              {t.emoji}
            </span>
            <span className="leading-tight">{t.label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
