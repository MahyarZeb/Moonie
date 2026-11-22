'use client';
/* eslint-disable @next/next/no-img-element -- YouTube thumbnails are tiny remote images, next/image adds nothing here */

import { ArrowDown, ArrowUp, Check, Play, X } from 'lucide-react';
import type { QueueItem } from '@shared/protocol';
import { IconButton } from '@/components/ui/IconButton';
import { useRoom, useRoomController } from '@/lib/room/RoomProvider';
import { selectCan } from '@/lib/room/selectors';
import { thumbnailUrl } from '@/lib/youtube/parse';
import { useVideoTitle } from '@/lib/youtube/useVideoTitle';
import { AddVideoBar } from './AddVideoBar';

const canManageQueue = selectCan('queue.manage');

/**
 * The shared "up next" list. Anyone can add or suggest. Hosts and co-hosts approve, play, reorder and
 * remove; people can withdraw their own items.
 */
export function QueuePanel() {
  const controller = useRoomController();
  const queue = useRoom((s) => s.snapshot?.queue);
  const suggestions = useRoom((s) => s.snapshot?.suggestions);
  const names = useRoom((s) => s.snapshot?.participants);
  const selfId = useRoom((s) => s.selfId);
  const manage = useRoom(canManageQueue);
  const send = (msg: Parameters<typeof controller.transport.send>[0]) => controller.transport.send(msg);
  const nameOf = (id: string) => names?.find((p) => p.id === id)?.name;
  // Controllers see every suggestion. Members see their own, waiting for approval.
  const visibleSuggestions = (suggestions ?? []).filter((s) => manage || s.addedBy === selfId);

  return (
    <div className="space-y-4">
      <AddVideoBar />

      {visibleSuggestions.length > 0 && (
        <section aria-label="Suggestions" className="space-y-2">
          <h3 className="px-1 text-sm font-bold text-ink-soft">{manage ? 'Suggestions' : 'Waiting for approval'}</h3>
          <ul className="space-y-2">
            {visibleSuggestions.map((item) => (
              <QueueRow
                key={item.id}
                item={item}
                adder={nameOf(item.addedBy)}
                caption={manage ? undefined : 'Waiting for approval'}
              >
                {manage && (
                  <IconButton label="Approve" className="h-8 w-8" onClick={() => send({ type: 'queue:approve', itemId: item.id })}>
                    <Check size={14} />
                  </IconButton>
                )}
                <IconButton
                  label={manage ? 'Reject' : 'Withdraw'}
                  className="h-8 w-8"
                  onClick={() => send({ type: 'queue:remove', itemId: item.id })}
                >
                  <X size={14} />
                </IconButton>
              </QueueRow>
            ))}
          </ul>
        </section>
      )}

      {!queue || queue.length === 0 ? (
        <p className="rounded-2xl bg-surface-2 px-4 py-6 text-center text-sm text-ink-soft">
          Nothing is waiting. Add a video and it plays when the current one ends 🍿
        </p>
      ) : (
        <ol className="space-y-2" aria-label="Up next">
          {queue.map((item, index) => (
            <QueueRow key={item.id} item={item} adder={nameOf(item.addedBy)}>
              {manage && (
                <>
                  <IconButton label="Play now" className="h-8 w-8" onClick={() => send({ type: 'queue:play', itemId: item.id })}>
                    <Play size={14} />
                  </IconButton>
                  <IconButton
                    label="Move up"
                    className="h-8 w-8"
                    disabled={index === 0}
                    onClick={() => send({ type: 'queue:reorder', itemId: item.id, toIndex: index - 1 })}
                  >
                    <ArrowUp size={14} />
                  </IconButton>
                  <IconButton
                    label="Move down"
                    className="h-8 w-8"
                    disabled={index === queue.length - 1}
                    onClick={() => send({ type: 'queue:reorder', itemId: item.id, toIndex: index + 1 })}
                  >
                    <ArrowDown size={14} />
                  </IconButton>
                </>
              )}
              {(manage || item.addedBy === selfId) && (
                <IconButton label="Remove" className="h-8 w-8" onClick={() => send({ type: 'queue:remove', itemId: item.id })}>
                  <X size={14} />
                </IconButton>
              )}
            </QueueRow>
          ))}
        </ol>
      )}
    </div>
  );
}

function QueueRow({
  item,
  adder,
  caption,
  children,
}: {
  item: QueueItem;
  adder?: string;
  caption?: string;
  children: React.ReactNode;
}) {
  const title = useVideoTitle(item.videoId, item.title);
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-surface-2 p-2" aria-label={title}>
      <img src={thumbnailUrl(item.videoId)} alt="" width={80} height={45} loading="lazy" className="h-[45px] w-20 shrink-0 rounded-xl bg-lavender/30 object-cover" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{title}</p>
        <p className="truncate text-xs text-ink-soft">{caption ?? `Added by ${adder ?? 'someone'}`}</p>
      </div>
      <div className="flex shrink-0 gap-0.5">{children}</div>
    </li>
  );
}