'use client';

import { motion } from 'motion/react';
import { Armchair } from 'lucide-react';
import { useRoom } from '@/lib/room/RoomProvider';
import { selectIsHost } from '@/lib/room/selectors';
import { getRoomTheme } from '@/lib/theme/roomThemes';

/**
 * The main player area. Media sources (YouTube, screen share, local files) mount here as they are added.
 * For now it renders the empty state, which is what a room with no media always shows.
 */
export function MediaStage() {
  const theme = useRoom((s) => s.snapshot?.theme);
  const isHost = useRoom(selectIsHost);
  const info = getRoomTheme(theme);

  return (
    <section aria-label="Player" className="card-soft stage-backdrop relative flex aspect-video min-h-[220px] w-full items-center justify-center overflow-hidden p-6">
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="max-w-sm text-center">
        <div className="mb-2 flex justify-center gap-2 text-4xl" aria-hidden>
          {info.decor.map((e) => (
            <span key={e}>{e}</span>
          ))}
        </div>
        <h2 className="flex items-center justify-center gap-2 text-2xl">
          <Armchair size={22} aria-hidden /> Your stage is ready
        </h2>
        <p className="mt-2 text-ink-soft">
          {isHost
            ? 'You are the host. Invite your friends and get cozy. Whatever you play will show up right here.'
            : 'Nothing is playing yet. The host will pick something to watch, and it will show up right here.'}
        </p>
      </motion.div>
    </section>
  );
}
