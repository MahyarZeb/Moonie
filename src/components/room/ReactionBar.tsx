'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { REACTION_EMOJI } from '@shared/constants';
import { useRoom, useRoomController } from '@/lib/room/RoomProvider';
import { selectCan } from '@/lib/room/selectors';

const canReact = selectCan('reaction.send');
const LIFETIME_MS = 2400;
const MAX_FLOATING = 12;

interface Floating {
  id: number;
  emoji: string;
  /** Horizontal start, percent of the stage width. */
  left: number;
}

/** Six emoji buttons. Reactions are not stored and are allowed even when muted (the server decides). */
export function ReactionBar() {
  const controller = useRoomController();
  const allowed = useRoom(canReact);
  if (!allowed) return null;
  return (
    <div role="group" aria-label="Reactions" className="flex flex-wrap items-center justify-center gap-1.5">
      {REACTION_EMOJI.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={`React ${emoji}`}
          onClick={() => controller.transport.send({ type: 'reaction:send', emoji })}
          className="h-10 w-10 rounded-full bg-surface-2 text-xl transition hover:-translate-y-0.5 hover:bg-lavender/40 active:scale-90"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

/** Emoji that float up over the stage when anyone reacts. Pointer events pass through to the player. */
export function ReactionLayer() {
  const controller = useRoomController();
  const [items, setItems] = useState<Floating[]>([]);
  const nextId = useRef(1);

  useEffect(
    () =>
      controller.onReaction((_from, emoji) => {
        const id = nextId.current++;
        setItems((prev) => [...prev.slice(-(MAX_FLOATING - 1)), { id, emoji, left: 10 + Math.random() * 80 }]);
        setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), LIFETIME_MS);
      }),
    [controller],
  );

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-3xl">
      <AnimatePresence>
        {items.map((i) => (
          <motion.span
            key={i.id}
            className="absolute bottom-2 text-3xl"
            style={{ left: `${i.left}%` }}
            initial={{ opacity: 0, y: 0, scale: 0.6 }}
            animate={{ opacity: [0, 1, 1, 0], y: -140, scale: 1.1 }}
            transition={{ duration: LIFETIME_MS / 1000, ease: 'easeOut' }}
          >
            {i.emoji}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}