'use client';

import { RefreshCw, WifiOff } from 'lucide-react';
import { CLOSE_REPLACED } from '@shared/constants';
import { Button } from '@/components/ui/Button';
import { useRoom, useRoomController } from '@/lib/room/RoomProvider';

/** Shown while a joined room has no live connection. Offers a manual Reconnect that resumes the same seat. */
export function ReconnectBanner() {
  const controller = useRoomController();
  const connection = useRoom((s) => s.connection);
  const attempt = useRoom((s) => s.attempt);
  const closeCode = useRoom((s) => s.closeCode);
  const phase = useRoom((s) => s.phase);
  if (phase !== 'in-room' || connection === 'open' || connection === 'idle') return null;

  const retrying = connection === 'reconnecting' || connection === 'connecting';
  let text: string;
  if (retrying) text = `Reconnecting${attempt > 1 ? ` (try ${attempt})` : ''}…`;
  else if (closeCode === CLOSE_REPLACED) text = 'Moonie is open in another tab. Reconnect here?';
  else if (connection === 'failed') text = 'Cannot reach the server right now.';
  else text = 'You were disconnected.';

  return (
    <div role="status" className="relative z-20 flex flex-wrap items-center justify-center gap-3 bg-pink/60 px-4 py-2 text-sm font-bold">
      <WifiOff size={16} aria-hidden />
      <span>{text}</span>
      {!retrying && (
        <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} onClick={() => controller.transport.reconnect()}>
          {connection === 'failed' ? 'Try again' : 'Reconnect'}
        </Button>
      )}
    </div>
  );
}
