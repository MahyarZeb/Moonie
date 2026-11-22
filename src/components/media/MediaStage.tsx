'use client';

import { motion } from 'motion/react';
import { Armchair, MonitorPlay } from 'lucide-react';
import { useRoom } from '@/lib/room/RoomProvider';
import { selectIsHost } from '@/lib/room/selectors';
import { getRoomTheme } from '@/lib/theme/roomThemes';
import { useVideoTitle } from '@/lib/youtube/useVideoTitle';
import { LocalStage } from './LocalStage';
import { ScreenView } from './ScreenView';
import { SourceSelector } from './SourceSelector';
import { YouTubePlayer, type YouTubeMedia } from './YouTubePlayer';

/** The main player area: the current media on top and, for the host, the source selector below. */
export function MediaStage() {
  const media = useRoom((s) => s.snapshot?.media ?? null);
  const isHost = useRoom(selectIsHost);

  return (
    <div className="space-y-4">
      {media?.kind === 'youtube' ? (
        <>
          <YouTubePlayer key={isHost ? 'host' : 'follower'} media={media} />
          <NowPlaying media={media} />
        </>
      ) : media?.kind === 'screen' ? (
        <ScreenView key={media.sessionId} media={media} />
      ) : media?.kind === 'local' ? (
        <LocalStage key={`${media.file.name}|${media.file.size}|${media.file.lastModified}`} media={media} />
      ) : (
        <EmptyStage />
      )}
      {isHost && <SourceSelector />}
    </div>
  );
}

function NowPlaying({ media }: { media: YouTubeMedia }) {
  const title = useVideoTitle(media.videoId, media.title);
  return (
    <p className="flex items-center gap-2 px-1 text-sm font-semibold text-ink-soft">
      <MonitorPlay size={16} aria-hidden />
      <span className="truncate">Now playing: {title}</span>
    </p>
  );
}

function EmptyStage() {
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
            ? 'You are the host. Paste a YouTube link, share your screen or pick a video file below to start watching together.'
            : 'Nothing is playing yet. Add a YouTube link in the Queue tab, or wait for the host to pick something.'}
        </p>
      </motion.div>
    </section>
  );
}
