'use client';

import { useId } from 'react';
import { AVATAR_EMOJI, AVATAR_IDS, LIMITS } from '@shared/constants';
import type { AvatarId } from '@shared/protocol';
import { cn } from '@/lib/utils/cn';

/** Display name field plus the avatar grid. Used by the create dialog, the lobby and settings. */
export function ProfilePicker({
  name,
  avatar,
  onName,
  onAvatar,
}: {
  name: string;
  avatar: AvatarId;
  onName: (value: string) => void;
  onAvatar: (value: AvatarId) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${id}-name`} className="mb-1 block text-sm font-bold">
          Your name
        </label>
        <input
          id={`${id}-name`}
          className="input-soft"
          value={name}
          maxLength={LIMITS.displayNameMax}
          autoComplete="nickname"
          placeholder="Mochi"
          onChange={(e) => onName(e.target.value)}
        />
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-bold">Pick an avatar</legend>
        <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label="Avatar">
          {AVATAR_IDS.map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={a === avatar}
              aria-label={a}
              onClick={() => onAvatar(a)}
              className={cn(
                'flex aspect-square items-center justify-center rounded-2xl border-2 text-2xl transition hover:-translate-y-0.5',
                a === avatar ? 'border-purple bg-lavender/40 shadow-glow' : 'border-transparent bg-surface-2 hover:border-lavender',
              )}
            >
              {AVATAR_EMOJI[a]}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
