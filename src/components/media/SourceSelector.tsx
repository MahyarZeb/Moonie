'use client';

import { useState } from 'react';
import { FolderOpen, ListPlus, Play, MonitorPlay, ScreenShare } from 'lucide-react';
import { Tabs } from '@/components/ui/Tabs';
import { useRoomController } from '@/lib/room/RoomProvider';
import { LocalFilePanel } from './LocalFilePanel';
import { ScreenSharePanel } from './ScreenSharePanel';
import { YouTubeUrlForm } from './YouTubeUrlForm';

type Source = 'youtube' | 'screen' | 'local';

/**
 * Host-only picker for what the room watches: YouTube, a shared screen or a local video file.
 */
export function SourceSelector() {
  const controller = useRoomController();
  const [source, setSource] = useState<Source>('youtube');

  return (
    <div className="card-soft space-y-3 p-4">
      <Tabs<Source>
        label="Media source"
        value={source}
        onChange={setSource}
        tabs={[
          { id: 'youtube', label: 'YouTube', icon: <MonitorPlay size={16} aria-hidden /> },
          { id: 'screen', label: 'Screen', icon: <ScreenShare size={16} aria-hidden /> },
          { id: 'local', label: 'Local file', icon: <FolderOpen size={16} aria-hidden /> },
        ]}
      />
      {source === 'screen' ? (
        <ScreenSharePanel />
      ) : source === 'local' ? (
        <LocalFilePanel />
      ) : (
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
      )}
    </div>
  );
}
