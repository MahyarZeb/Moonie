'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { loadYouTubeApi } from './loadApi';
import type { YTPlayer } from './types';

export type PlayerStatus = 'loading' | 'ready' | 'error';

export interface UseYouTubePlayerOptions {
  /** Controllers (host and co-hosts) get the native YouTube controls; followers are driven by the sync loop. */
  canControl: boolean;
  onStateChange: (state: number) => void;
  onError: (code: number) => void;
}

export interface UseYouTubePlayerResult {
  containerRef: RefObject<HTMLDivElement | null>;
  playerRef: RefObject<YTPlayer | null>;
  status: PlayerStatus;
  retry: () => void;
}

/**
 * Creates one YT.Player for the lifetime of the component (and per host/follower mode).
 * Videos are loaded into it by the caller with `loadVideoById`, so it is never rebuilt on re-render.
 */
export function useYouTubePlayer({ canControl, onStateChange, onError }: UseYouTubePlayerOptions): UseYouTubePlayerResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [status, setStatus] = useState<PlayerStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const handlers = useRef({ onStateChange, onError });

  useEffect(() => {
    handlers.current = { onStateChange, onError };
  });

  useEffect(() => {
    let cancelled = false;
    let player: YTPlayer | null = null;
    loadYouTubeApi()
      .then((YT) => {
        const container = containerRef.current;
        if (cancelled || !container) return;
        const mount = document.createElement('div');
        container.appendChild(mount);
        player = new YT.Player(mount, {
          host: 'https://www.youtube-nocookie.com',
          playerVars: {
            enablejsapi: 1,
            origin: window.location.origin,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            controls: canControl ? 1 : 0,
            disablekb: canControl ? 0 : 1,
            fs: 0,
          },
          events: {
            onReady: () => {
              if (cancelled) return;
              playerRef.current = player;
              setStatus('ready');
            },
            onStateChange: (e) => handlers.current.onStateChange(e.data),
            onError: (e) => handlers.current.onError(e.data),
          },
        });
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
      playerRef.current = null;
      try {
        player?.destroy();
      } catch {
        /* the iframe is already gone */
      }
    };
  }, [canControl, attempt]);

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((n) => n + 1);
  }, []);

  return { containerRef, playerRef, status, retry };
}
