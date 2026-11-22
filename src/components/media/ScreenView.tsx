'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Maximize, MonitorOff, Volume2, VolumeX } from 'lucide-react';
import type { MediaState } from '@shared/protocol';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Spinner } from '@/components/ui/Spinner';
import { useRoom, useRoomController } from '@/lib/room/RoomProvider';
import { canReceiveStream } from '@/lib/webrtc/support';
import { ShareViewer, type ViewerState } from '@/lib/webrtc/ShareViewer';
import { LiveBadge } from './LiveBadge';

export type ScreenMedia = Extract<MediaState, { kind: 'screen' }>;

/** The main player area while a screen is shared. Mount with `key={sessionId}` so each session starts clean. */
export function ScreenView({ media }: { media: ScreenMedia }) {
  const selfId = useRoom((s) => s.selfId);
  const sharerName = useRoom((s) => s.snapshot?.participants.find((p) => p.id === media.sharerId)?.name ?? 'Someone');
  const isSharer = media.sharerId === selfId;

  return (
    <section aria-label="Shared screen" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <LiveBadge label={isSharer ? 'You are sharing' : 'LIVE'} />
        <span className="text-sm font-semibold text-ink-soft">
          {isSharer ? 'Everyone can see your screen' : `${sharerName} is sharing their screen`}
        </span>
      </div>
      {isSharer ? <SharerPreview /> : <ViewerScreen media={media} />}
    </section>
  );
}

function fullscreen(el: HTMLElement | null) {
  if (!el) return;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void el.requestFullscreen?.();
}

function SharerPreview() {
  const share = useRoomController().share;
  const state = useSyncExternalStore(share.subscribe, share.getState, share.getState);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = state.stream;
  }, [state.stream]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-3xl bg-black/80">
      <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-contain" />
      {!state.stream && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner size={32} label="Starting preview" />
        </div>
      )}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2">
        <p className="rounded-full bg-surface/85 px-3 py-1 text-xs font-semibold">This is a muted preview of what everyone sees.</p>
        <Button size="sm" variant="danger" icon={<MonitorOff size={14} aria-hidden />} onClick={() => share.stop()}>
          Stop
        </Button>
      </div>
    </div>
  );
}

function ViewerScreen({ media }: { media: ScreenMedia }) {
  const controller = useRoomController();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewerRef = useRef<ShareViewer | null>(null);
  const [state, setState] = useState<ViewerState>('connecting');
  const [hasStream, setHasStream] = useState(false);
  const [muted, setMuted] = useState(true);
  const supported = canReceiveStream();

  useEffect(() => {
    if (!supported) return;
    const viewer = new ShareViewer({
      transport: controller.transport,
      sharerId: media.sharerId,
      sessionId: media.sessionId,
      onStream: (stream) => {
        if (videoRef.current) videoRef.current.srcObject = stream;
        setHasStream(true);
      },
      onState: setState,
    });
    viewerRef.current = viewer;
    viewer.start();
    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [controller, media.sharerId, media.sessionId, supported]);

  if (!supported) {
    return (
      <div className="card-soft flex aspect-video items-center justify-center p-6 text-center">
        <p className="flex items-center gap-2 font-semibold">
          <AlertTriangle size={18} aria-hidden /> This browser can&apos;t receive shared screens.
        </p>
      </div>
    );
  }

  const showVideo = hasStream && state === 'connected';

  return (
    <div ref={wrapperRef} className="relative aspect-video w-full overflow-hidden rounded-3xl bg-black/80">
      <video ref={videoRef} autoPlay muted={muted} playsInline className="h-full w-full object-contain" />
      {showVideo && (
        <div className="absolute right-3 top-3 z-20 flex gap-2">
          {media.hasAudio && (
            <IconButton label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted(!muted)} className="bg-surface/80">
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </IconButton>
          )}
          <IconButton label="Toggle fullscreen" onClick={() => fullscreen(wrapperRef.current)} className="bg-surface/80">
            <Maximize size={18} />
          </IconButton>
        </div>
      )}
      {!showVideo && state !== 'failed' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-lavender/60 to-pink/50 backdrop-blur-sm">
          <Spinner size={32} label="Connecting" />
          <p className="font-bold text-ink">{state === 'reconnecting' ? 'Reconnecting…' : 'Connecting to the shared screen…'}</p>
        </div>
      )}
      {state === 'failed' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface/90 p-4 text-center backdrop-blur">
          <AlertTriangle aria-hidden />
          <p className="font-bold">Couldn&apos;t connect to the shared screen</p>
          <p className="max-w-sm text-sm text-ink-soft">
            Some strict networks block direct connections and need a TURN server. Trying again often helps.
          </p>
          <Button size="sm" onClick={() => viewerRef.current?.retry()}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
