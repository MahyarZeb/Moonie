'use client';

import { motion } from 'motion/react';
import { Armchair, MonitorPlay, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ReactionBar, ReactionLayer } from '@/components/room/ReactionBar';
import { useRoom, useRoomController } from '@/lib/room/RoomProvider';
import { selectIsController } from '@/lib/room/selectors';
import { getRoomTheme } from '@/lib/theme/roomThemes';
import { useVideoTitle } from '@/lib/youtube/useVideoTitle';
import { AddVideoBar } from './AddVideoBar';
import { LocalStage } from './LocalStage';
import { ScreenView } from './ScreenView';
import { SourceSelector } from './SourceSelector';
import { YouTubePlayer, type YouTubeMedia } from './YouTubePlayer';

/** The main player area: the current media on top, reactions and the Add video box for everyone, and the source selector for hosts and co-hosts. */
export function MediaStage() {
  const media = useRoom((s) => s.snapshot?.media ?? null);
  const isHost = useRoom(selectIsController);

  return (
    <div className="space-y-4">
      <div className="relative space-y-4">
      {media?.kind === 'youtube' ? (
        <>
          <YouTubePlayer key={isHost ? 'controller' : 'follower'} media={media} />
          <NowPlaying media={media} />
        </>
      ) : media?.kind === 'screen' ? (
        <ScreenView key={media.sessionId} media={media} />
      ) : media?.kind === 'local' ? (
        <LocalStage key={`${media.file.name}|${media.file.size}|${media.file.lastModified}`} media={media} />
      ) : (
        <EmptyStage />
      )}
      <ReactionLayer />
      </div>
      <ReactionBar />
      <AddVideoBar />
      {isHost && <SourceSelector />}
    </div>
  );
}

function NowPlaying({ media }: { media: YouTubeMedia }) {
  const controller = useRoomController();
  const title = useVideoTitle(media.videoId, media.title);
  const canSkip = useRoom(selectIsController);
  return (
    <div className="flex items-center gap-2 px-1 text-sm font-semibold text-ink-soft">
      <MonitorPlay size={16} aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">Now playing: {title}</span>
      {canSkip && (
        <Button size="sm" variant="secondary" icon={<SkipForward size={14} aria-hidden />} onClick={() => controller.transport.send({ type: 'queue:skip' })}>
          Skip
        </Button>
      )}
    </div>
  );
}

function EmptyStage() {
  const theme = useRoom((s) => s.snapshot?.theme);
  const isHost = useRoom(selectIsController);
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
