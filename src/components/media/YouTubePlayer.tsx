'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Maximize, Volume2, VolumeX } from 'lucide-react';
import { expectedPosition } from '@shared/playback';
import type { MediaState } from '@shared/protocol';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Spinner } from '@/components/ui/Spinner';
import { serverNow } from '@/lib/room/clockSync';
import { useRoom, useRoomController } from '@/lib/room/RoomProvider';
import { selectIsHost } from '@/lib/room/selectors';
import { describeYouTubeError } from '@/lib/youtube/errors';
import { detectSeek, FollowerSync } from '@/lib/youtube/syncController';
import { YT_STATE } from '@/lib/youtube/types';
import { useYouTubePlayer } from '@/lib/youtube/useYouTubePlayer';

export type YouTubeMedia = Extract<MediaState, { kind: 'youtube' }>;

const POLL_MS = 500;
const SUPPRESS_MS = 750;

/**
 * Plays the room's YouTube video with the official IFrame API.
 * The host drives playback (its commands go to the server); followers are corrected by `FollowerSync`.
 * Mount it with `key={isHost}` so the player is rebuilt with the right controls when the host changes.
 */
export function YouTubePlayer({ media }: { media: YouTubeMedia }) {
  const controller = useRoomController();
  const isHost = useRoom(selectIsHost);
  const [loadedRev, setLoadedRev] = useState<number | null>(null);
  const [error, setError] = useState<{ rev: number; code: number } | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [muted, setMuted] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const syncRef = useRef<FollowerSync | null>(null);
  const loadedRevRef = useRef<number | null>(null);
  const hostSuppressUntil = useRef(0);
  const lastPoll = useRef({ pos: 0, at: 0, quietUntil: 0 });

  const { containerRef, playerRef, status, retry } = useYouTubePlayer({
    isHost,
    onStateChange: (state) => handleState(state),
    onError: (code) => handleError(code),
  });

  const currentMedia = () => {
    const m = controller.store.getState().snapshot?.media;
    return m?.kind === 'youtube' ? m : null;
  };

  /** Sends a host command unless the server already agrees with what the player is doing. */
  const sendCommand = (action: 'play' | 'pause' | 'seek', force = false) => {
    const player = playerRef.current;
    const m = currentMedia();
    const snapshot = controller.store.getState().snapshot;
    if (!player || !m || !snapshot) return;
    const now = serverNow(controller.transport);
    const pos = player.getCurrentTime();
    if (!force) {
      const pb = snapshot.playback;
      const agrees =
        action === 'play'
          ? pb.status === 'playing' && Math.abs(expectedPosition(pb, now) - pos) < 1
          : action === 'pause' && pb.status === 'paused' && Math.abs(pb.positionSec - pos) < 0.5;
      if (agrees) return;
    }
    controller.transport.send({ type: 'playback:command', rev: m.rev, action, positionSec: pos, hostServerTime: now });
  };

  function handleState(state: number) {
    const m = currentMedia();
    if (!m) return;
    if (state === YT_STATE.PLAYING || state === YT_STATE.PAUSED || state === YT_STATE.CUED) {
      if (loadedRevRef.current === m.rev) setLoadedRev(m.rev);
    }
    if (!isHost) {
      syncRef.current?.noteState(state);
      if (!syncRef.current?.suppressed) syncRef.current?.sync();
      return;
    }
    if (Date.now() < hostSuppressUntil.current) return;
    lastPoll.current = { pos: playerRef.current?.getCurrentTime() ?? 0, at: Date.now(), quietUntil: lastPoll.current.quietUntil };
    if (state === YT_STATE.PLAYING) sendCommand('play');
    else if (state === YT_STATE.PAUSED) sendCommand('pause');
    else if (state === YT_STATE.BUFFERING) lastPoll.current.quietUntil = Date.now() + 1000;
    else if (state === YT_STATE.ENDED) controller.transport.send({ type: 'media:ended', rev: m.rev });
  }

  function handleError(code: number) {
    const m = currentMedia();
    if (!m) return;
    setError({ rev: m.rev, code });
    if (isHost) controller.transport.send({ type: 'media:error', rev: m.rev, code });
  }

  // Load (or cue, when the room is paused) whenever the media revision changes.
  useEffect(() => {
    if (status !== 'ready') return;
    const player = playerRef.current;
    if (!player || loadedRevRef.current === media.rev) return;
    loadedRevRef.current = media.rev;
    const { playback } = controller.store.getState().snapshot ?? {};
    const start = playback ? expectedPosition(playback, serverNow(controller.transport)) : 0;
    hostSuppressUntil.current = Date.now() + SUPPRESS_MS;
    syncRef.current?.reset();
    lastPoll.current = { pos: start, at: Date.now(), quietUntil: Date.now() + 1500 };
    if (playback?.status === 'paused') player.cueVideoById({ videoId: media.videoId, startSeconds: start });
    else player.loadVideoById({ videoId: media.videoId, startSeconds: start });
  }, [status, media.rev, media.videoId, controller, playerRef]);

  // Follower: keep aligned with the host.
  useEffect(() => {
    if (isHost || status !== 'ready') return;
    const sync = new FollowerSync({
      getPlayer: () => playerRef.current,
      getPlayback: () => controller.store.getState().snapshot!.playback,
      serverNow: () => serverNow(controller.transport),
      onAutoplayBlocked: setBlocked,
    });
    syncRef.current = sync;
    sync.start();
    let last = controller.store.getState().snapshot?.playback;
    const off = controller.store.subscribe(() => {
      const pb = controller.store.getState().snapshot?.playback;
      if (pb && pb !== last) {
        last = pb;
        sync.sync();
      }
    });
    return () => {
      off();
      sync.stop();
      syncRef.current = null;
    };
  }, [isHost, status, controller, playerRef]);

  // Host: detect seeks from the native controls.
  useEffect(() => {
    if (!isHost || status !== 'ready') return;
    const timer = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      const now = Date.now();
      const state = player.getPlayerState();
      const cur = player.getCurrentTime();
      const prev = lastPoll.current;
      const quiet = state === YT_STATE.BUFFERING || now < prev.quietUntil || now < hostSuppressUntil.current;
      const watchable = state === YT_STATE.PLAYING || state === YT_STATE.PAUSED;
      if (watchable && !quiet && detectSeek({ lastPos: prev.pos, elapsedMs: now - prev.at, currentTime: cur, playing: state === YT_STATE.PLAYING })) {
        sendCommand('seek', true);
      }
      lastPoll.current = { pos: cur, at: now, quietUntil: state === YT_STATE.BUFFERING ? now + 1000 : prev.quietUntil };
    }, POLL_MS);
    return () => clearInterval(timer);
    // sendCommand only reads refs and the store, so it is safe to leave out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, status, controller, playerRef]);

  const toggleMute = () => {
    const player = playerRef.current;
    if (!player) return;
    if (muted) player.unMute();
    else player.mute();
    setMuted(!muted);
  };

  const fullscreen = () => {
    const el = wrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const playerError = error && error.rev === media.rev ? error : null;
  const loading = !playerError && status !== 'error' && loadedRev !== media.rev;

  return (
    <div ref={wrapperRef} className="relative aspect-video w-full overflow-hidden rounded-3xl bg-black/80">
      <div ref={containerRef} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />
      {!isHost && <div className="absolute inset-0" aria-hidden />}

      <div className="absolute right-3 top-3 z-20 flex gap-2">
        {!isHost && (
          <IconButton label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute} className="bg-surface/80">
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </IconButton>
        )}
        <IconButton label="Toggle fullscreen" onClick={fullscreen} className="bg-surface/80">
          <Maximize size={18} />
        </IconButton>
      </div>

      {loading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-lavender/60 to-pink/50 backdrop-blur-sm">
          <Spinner size={32} label="Loading video" />
          <p className="font-bold text-ink">Fetching your video…</p>
        </div>
      )}

      {status === 'error' && (
        <Overlay>
          <AlertTriangle aria-hidden />
          <p className="font-bold">Couldn&apos;t load YouTube</p>
          <p className="text-sm text-ink-soft">An extension, a network block or being offline can stop the player.</p>
          <Button size="sm" onClick={retry}>
            Retry
          </Button>
        </Overlay>
      )}

      {playerError && (
        <Overlay>
          <AlertTriangle aria-hidden />
          <p className="font-bold">{describeYouTubeError(playerError.code)}</p>
          <p className="text-sm text-ink-soft">
            {isHost ? 'Moving on to the next video if there is one. You can also pick another below.' : 'The host will pick something else.'}
          </p>
        </Overlay>
      )}

      {blocked && !isHost && (
        <Overlay>
          <p className="text-2xl" aria-hidden>
            🍿
          </p>
          <p className="font-bold">Your browser paused the video</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => syncRef.current?.resume(false)}>Tap to join 🍿</Button>
            <Button variant="secondary" onClick={() => syncRef.current?.resume(true)}>
              Start muted
            </Button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface/90 p-4 text-center backdrop-blur">
      {children}
    </div>
  );
}
