'use client';

import { ListPlus, Play, MonitorPlay } from 'lucide-react';
import { Tabs } from '@/components/ui/Tabs';
import { useRoomController } from '@/lib/room/RoomProvider';
import { YouTubeUrlForm } from './YouTubeUrlForm';

type Source = 'youtube';

/**
 * Host-only picker for what the room watches. Only sources that exist are listed:
 * screen share and local files join the tabs in their own phases.
 */
export function SourceSelector() {
  const controller = useRoomController();

  return (
    <div className="card-soft space-y-3 p-4">
      <Tabs<Source>
        label="Media source"
        value="youtube"
        onChange={() => undefined}
        tabs={[{ id: 'youtube', label: 'YouTube', icon: <MonitorPlay size={16} aria-hidden /> }]}
      />
      <YouTubeUrlForm
        actions={[
          {
            label: 'Play now',
            icon: <Play size={16} aria-hidden />,
            run: async ({ videoId, startSec }) => {
              const reply = await controller.transport.request({ type: 'media:set', media: { kind: 'youtube', videoId } });
              if (startSec && reply.type === 'media:state' && reply.media?.kind === 'youtube') {
                controller.transport.send({
                  type: 'playback:command',
                  rev: reply.media.rev,
                  action: 'seek',
                  positionSec: startSec,
                });
              }
            },
          },
          {
            label: 'Add to queue',
            icon: <ListPlus size={16} aria-hidden />,
            run: async ({ videoId }) => {
              await controller.transport.request({ type: 'queue:add', videoId });
            },
          },
        ]}
      />
    </div>
  );
}
