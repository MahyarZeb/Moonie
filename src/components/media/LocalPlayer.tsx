'use client';

import { useEffect, useRef, useState } from 'react';
import { expectedPosition } from '@shared/playback';
import type { MediaState } from '@shared/protocol';
import { Button } from '@/components/ui/Button';
import { serverNow } from '@/lib/room/clockSync';
import { useRoomController } from '@/lib/room/RoomProvider';
import { LocalFollowerSync } from '@/lib/localfile/sync';
import { PlayerControls } from './PlayerControls';

export type LocalMedia = Extract<MediaState, { kind: 'local' }>;

const SUPPRESS_MS = 750;

interface Props {
  media: LocalMedia;
  /** Object URL of this tab's own copy of the file. */
  url: string;
  isHost: boolean;
}

/**
 * Plays this tab's copy of the file. The host's element is the source of truth and sends playback
 * commands; followers are corrected by `LocalFollowerSync`. Keep it mounted across same-file and
 * stream conversions of the same file, because the stream is captured from this element.
 */
export function LocalPlayer({ media, url, isHost }: Props) {
  const controller = useRoomController();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const syncRef = useRef<LocalFollowerSync | null>(null);
  const suppressUntil = useRef(0);
  const [ui, setUi] = useState({ paused: true, time: 0, duration: media.file.durationSec ?? 0, volume: 1, muted: false });
  const [blocked, setBlocked] = useState(false);

  const currentMedia = () => {
    const m = controller.store.getState().snapshot?.media;
    return m?.kind === 'local' ? m : null;
  };

  /** Sends a host command unless the server already agrees with what the element is doing. */
  const sendCommand = (action: 'play' | 'pause' | 'seek', force = false) => {
    const video = videoRef.current;
    const m = currentMedia();
    const snapshot = controller.store.getState().snapshot;
    if (!video || !m || !snapshot || Date.now() < suppressUntil.current) return;
    const now = serverNow(controller.transport);
    const pos = video.currentTime;
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

  // Let the share machinery capture this element for "Stream from my device".
  useEffect(() => {
    const store = controller.localFile;
    store.setElement(videoRef.current);
    return () => store.setElement(null);
  }, [controller, url]);

  // Followers poll every second. Controllers (host and co-hosts) only apply changes made by someone else,
  // so their own actions are not fought by the loop and not echoed back.
  useEffect(() => {
    const sync = new LocalFollowerSync({
      getVideo: () => videoRef.current,
      getPlayback: () => controller.store.getState().snapshot!.playback,
      serverNow: () => serverNow(controller.transport),
      onAutoplayBlocked: setBlocked,
    });
    syncRef.current = sync;
    if (!isHost) sync.start();
    let last = controller.store.getState().snapshot?.playback;
    const off = controller.store.subscribe(() => {
      const { snapshot, selfId } = controller.store.getState();
      const pb = snapshot?.playback;
      if (!pb || pb === last) return;
      last = pb;
      if (isHost) {
        if (pb.by === selfId) return;
        suppressUntil.current = Date.now() + SUPPRESS_MS;
      }
      sync.sync();
    });
    return () => {
      off();
      sync.stop();
      syncRef.current = null;
    };
  }, [isHost, controller]);

  // Host: when the server pauses the room (for example a stream ended), stop the element too.
  useEffect(() => {
    if (!isHost) return;
    const video = videoRef.current;
    const pb = controller.store.getState().snapshot?.playback;
    if (video && pb?.status === 'paused' && !video.paused) {
      suppressUntil.current = Date.now() + SUPPRESS_MS;
      video.pause();
    }
  }, [isHost, media.rev, controller]);

  const onLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    setUi((u) => ({ ...u, duration: Number.isFinite(video.duration) ? video.duration : u.duration }));
    if (isHost) {
      // A new or resumed host starts where the room was.
      const pb = controller.store.getState().snapshot?.playback;
      if (pb) {
        suppressUntil.current = Date.now() + SUPPRESS_MS;
        video.currentTime = expectedPosition(pb, serverNow(controller.transport), video.duration);
      }
    } else {
      syncRef.current?.sync();
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };

  const fullscreen = () => {
    const el = wrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  return (
    <div
      ref={wrapperRef}
      className="relative flex w-full flex-col overflow-hidden rounded-3xl bg-black/80 [&:fullscreen]:h-full"
    >
      <video
        ref={videoRef}
        src={url}
        playsInline
        preload="auto"
        aria-label={media.file.name}
        className="aspect-video w-full bg-black object-contain [:fullscreen_&]:aspect-auto [:fullscreen_&]:min-h-0 [:fullscreen_&]:flex-1"
        onLoadedMetadata={onLoadedMetadata}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setUi((u) => ({ ...u, duration: d }));
        }}
        onTimeUpdate={(e) => setUi((u) => ({ ...u, time: e.currentTarget.currentTime }))}
        onVolumeChange={(e) => setUi((u) => ({ ...u, volume: e.currentTarget.volume, muted: e.currentTarget.muted }))}
        onPlay={() => {
          setUi((u) => ({ ...u, paused: false }));
          if (isHost) sendCommand('play');
        }}
        onPause={(e) => {
          setUi((u) => ({ ...u, paused: true }));
          if (isHost && !e.currentTarget.ended) sendCommand('pause');
        }}
        onSeeked={() => {
          if (isHost) sendCommand('seek', true);
        }}
        onEnded={() => {
          const m = currentMedia();
          if (isHost && m) controller.transport.send({ type: 'media:ended', rev: m.rev });
        }}
      />
      <PlayerControls
        paused={ui.paused}
        currentTime={ui.time}
        duration={ui.duration}
        volume={ui.volume}
        muted={ui.muted}
        canControl={isHost}
        onTogglePlay={togglePlay}
        onSeek={(sec) => {
          if (videoRef.current) videoRef.current.currentTime = sec;
        }}
        onVolume={(v) => {
          const video = videoRef.current;
          if (!video) return;
          video.volume = v;
          video.muted = v === 0;
        }}
        onToggleMute={() => {
          if (videoRef.current) videoRef.current.muted = !videoRef.current.muted;
        }}
        onFullscreen={fullscreen}
      />

      {blocked && !isHost && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface/90 p-4 text-center backdrop-blur">
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
        </div>
      )}
    </div>
  );
}
