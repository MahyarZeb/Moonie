'use client';

import { useSyncExternalStore } from 'react';
import { AlertTriangle, MonitorOff, MonitorUp, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useRoomController } from '@/lib/room/RoomProvider';
import { getScreenShareSupport } from '@/lib/webrtc/support';
import { LiveBadge } from './LiveBadge';

/** Host-only controls for starting and stopping a screen share. */
export function ScreenSharePanel() {
  const controller = useRoomController();
  const share = controller.share;
  const state = useSyncExternalStore(share.subscribe, share.getState, share.getState);
  const support = useSyncExternalStore(
    () => () => undefined,
    getScreenShareSupport,
    () => 'ok' as const,
  );

  if (state.status === 'sharing') {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge label="You are sharing" />
          <span className="flex items-center gap-1 text-sm font-semibold text-ink-soft">
            {state.hasAudio ? <Volume2 size={15} aria-hidden /> : <VolumeX size={15} aria-hidden />}
            Audio: {state.hasAudio ? 'on' : 'off'}
          </span>
        </div>
        <p className="text-sm text-ink-soft">
          Everyone in the room sees what you share. You can also stop from your browser&apos;s own &ldquo;Stop sharing&rdquo; bar.
        </p>
        <Button variant="danger" icon={<MonitorOff size={16} aria-hidden />} onClick={() => share.stop()}>
          Stop sharing
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">
        Share your whole screen, a window or a browser tab. Pick a tab and tick &ldquo;share audio&rdquo; to bring the sound along.
      </p>
      {support !== 'ok' ? (
        <p className="flex items-start gap-2 rounded-2xl bg-surface-2 p-3 text-sm font-semibold" role="alert">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {support === 'insecure'
            ? 'Screen sharing needs a secure (https) page.'
            : "Screen sharing isn't available in this browser (most phones can't share their screen). You can still watch!"}
        </p>
      ) : (
        <Button
          icon={<MonitorUp size={16} aria-hidden />}
          loading={state.status === 'starting'}
          onClick={() => void share.start()}
        >
          Share my screen
        </Button>
      )}
      {state.error && (
        <p className="flex items-start gap-2 rounded-2xl bg-pink/30 p-3 text-sm font-semibold" role="alert">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {state.error.message}
        </p>
      )}
    </div>
  );
}
