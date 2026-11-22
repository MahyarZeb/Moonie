'use client';

import { ListPlus, Send } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { useRoom, useRoomController } from '@/lib/room/RoomProvider';
import { selectIsController } from '@/lib/room/selectors';
import { YouTubeUrlForm } from './YouTubeUrlForm';

/**
 * One box for everyone to add a YouTube video. A member's add becomes a suggestion while the room
 * requires approval, and never touches what is playing. The server decides; this only words it.
 */
export function AddVideoBar() {
  const controller = useRoomController();
  const toast = useToast();
  const isController = useRoom(selectIsController);
  const requireApproval = useRoom((s) => s.snapshot?.settings.requireApproval ?? true);
  const suggesting = !isController && requireApproval;

  return (
    <div className="space-y-1.5" data-testid="add-video-bar">
      <YouTubeUrlForm
        placeholder={suggesting ? 'Paste a YouTube link to suggest' : 'Paste a YouTube link to add'}
        actions={[
          {
            label: suggesting ? 'Suggest video' : 'Add video',
            icon: suggesting ? <Send size={16} aria-hidden /> : <ListPlus size={16} aria-hidden />,
            run: async ({ videoId }) => {
              await controller.transport.request({ type: 'queue:add', videoId });
              toast.show(suggesting ? 'Suggestion sent' : 'Added to the queue');
            },
          },
        ]}
      />
      {suggesting && <p className="px-1 text-xs text-ink-soft">Your video waits for a host to approve it.</p>}
    </div>
  );
}