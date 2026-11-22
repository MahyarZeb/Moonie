'use client';
import { useEffect, useRef } from 'react';

export const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  { label: 'Smileys', emojis: ['😀', '😄', '😁', '😆', '🥹', '😊', '🥰', '😍', '😘', '😋', '😎', '🤗', '🤭', '😴'] },
  { label: 'Moods', emojis: ['😂', '🤣', '😭', '🥺', '😳', '😱', '😡', '🙄', '😅', '🤔', '😌', '🫠', '😇'] },
  { label: 'Hearts', emojis: ['💖', '💗', '💓', '💞', '💕', '🩷', '💜', '💙', '🤍', '🧡', '💛', '💚', '❤️'] },
  { label: 'Cozy', emojis: ['🌙', '⭐', '✨', '☁️', '🌸', '🍓', '🍿', '🧸', '🎀', '☕', '🍰', '🍡', '🕯️'] },
  { label: 'Fun', emojis: ['🎬', '🎮', '🎲', '🎉', '🎊', '🔥', '💯', '👀', '🫶', '🙌', '👏', '🤝'] },
  { label: 'Animals', emojis: ['🐱', '🐶', '🐰', '🦊', '🐻', '🐼', '🦄', '🐸', '🐧', '🦋', '🐢', '🐙'] },
];

/** A small popover of static emojis. Closes on Escape or a click outside. */
export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && ref.current && !ref.current.contains(target) && !(target as HTMLElement).closest?.('[data-emoji-toggle]')) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Emoji picker"
      className="absolute bottom-full right-0 z-20 mb-2 max-h-64 w-72 max-w-[85vw] overflow-y-auto rounded-3xl border border-lavender/40 bg-surface p-3 shadow-soft scrollbar-soft"
    >
      {EMOJI_CATEGORIES.map((cat) => (
        <section key={cat.label} className="mb-2 last:mb-0">
          <h3 className="mb-1 text-xs font-bold text-ink-soft">{cat.label}</h3>
          <div className="flex flex-wrap gap-0.5">
            {cat.emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Insert ${emoji}`}
                onClick={() => onPick(emoji)}
                className="h-9 w-9 rounded-xl text-xl transition hover:scale-110 hover:bg-lavender/30 active:scale-95"
              >
                {emoji}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
