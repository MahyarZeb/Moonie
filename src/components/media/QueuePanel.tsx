'use client';

/* eslint-disable @next/next/no-img-element -- YouTube thumbnails are tiny remote images, next/image adds nothing here */
import { ArrowDown, ArrowUp, ListPlus, Play, X } from 'lucide-react';
import type { QueueItem } from '@shared/protocol';
import { IconButton } from '@/components/ui/IconButton';
import { useRoom, useRoomController } from '@/lib/room/RoomProvider';
import { selectIsController } from '@/lib/room/selectors';
import { thumbnailUrl } from '@/lib/youtube/parse';
import { useVideoTitle } from '@/lib/youtube/useVideoTitle';
import { YouTubeUrlForm } from './YouTubeUrlForm';

/** The shared "up next" list. Anyone can add; the host can play, reorder and remove; adders can remove their own. */
export function QueuePanel() {
  const controller = useRoomController();
  const queue = useRoom((s) => s.snapshot?.queue);
  const names = useRoom((s) => s.snapshot?.participants);
  const selfId = useRoom((s) => s.selfId);
  const isHost = useRoom(selectIsController);
  const send = (msg: Parameters<typeof controller.transport.send>[0]) => controller.transport.send(msg);

  return (
    <div className="space-y-4">
      <YouTubeUrlForm
        placeholder="Add a YouTube link to the queue"
        actions={[
          {
            label: 'Add to queue',
            icon: <ListPlus size={16} aria-hidden />,
            run: async ({ videoId }) => {
              await controller.transport.request({ type: 'queue:add', videoId });
            },
          },
        ]}
      />
      {!queue || queue.length === 0 ? (
        <p className="rounded-2xl bg-surface-2 px-4 py-6 text-center text-sm text-ink-soft">
          Nothing is waiting. Add a video and it plays when the current one ends 🍿
        </p>
      ) : (
        <ol className="space-y-2" aria-label="Up next">
          {queue.map((item, index) => (
            <QueueRow
              key={item.id}
              item={item}
              adder={names?.find((p) => p.id === item.addedBy)?.name}
              canRemove={isHost || item.addedBy === selfId}
              isHost={isHost}
              isFirst={index === 0}
              isLast={index === queue.length - 1}
              onPlay={() => send({ type: 'queue:play', itemId: item.id })}
              onRemove={() => send({ type: 'queue:remove', itemId: item.id })}
              onMove={(to) => send({ type: 'queue:reorder', itemId: item.id, toIndex: to })}
              index={index}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function QueueRow({
  item,
  adder,
  canRemove,
  isHost,
  isFirst,
  isLast,
  index,
  onPlay,
  onRemove,
  onMove,
}: {
  item: QueueItem;
  adder?: string;
  canRemove: boolean;
  isHost: boolean;
  isFirst: boolean;
  isLast: boolean;
  index: number;
  onPlay: () => void;
  onRemove: () => void;
  onMove: (to: number) => void;
}) {
  const title = useVideoTitle(item.videoId, item.title);
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-surface-2 p-2">
      <img src={thumbnailUrl(item.videoId)} alt="" width={80} height={45} loading="lazy" className="h-[45px] w-20 shrink-0 rounded-xl bg-lavender/30 object-cover" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{title}</p>
        <p className="truncate text-xs text-ink-soft">Added by {adder ?? 'someone'}</p>
      </div>
      <div className="flex shrink-0 gap-0.5">
        {isHost && (
          <>
            <IconButton label={`Play ${title} now`} className="h-8 w-8" onClick={onPlay}>
              <Play size={14} />
            </IconButton>
            <IconButton label="Move up" className="h-8 w-8" disabled={isFirst} onClick={() => onMove(index - 1)}>
              <ArrowUp size={14} />
            </IconButton>
            <IconButton label="Move down" className="h-8 w-8" disabled={isLast} onClick={() => onMove(index + 1)}>
              <ArrowDown size={14} />
            </IconButton>
          </>
        )}
        {canRemove && (
          <IconButton label={`Remove ${title}`} className="h-8 w-8" onClick={onRemove}>
            <X size={14} />
          </IconButton>
        )}
      </div>
    </li>
  );
}
