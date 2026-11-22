import { expectedPosition } from '@shared/playback';
import type { PlaybackState } from '@shared/protocol';

export const HARD_SEEK_SEC = 1.5;
export const NUDGE_SEC = 0.3;
const PAUSED_DRIFT_SEC = 0.5;
const NUDGE_RATE = 0.05;
const SEEK_COOLDOWN_MS = 1500;

export type LocalSyncAction =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; to: number }
  | { type: 'rate'; rate: number };

export interface LocalSyncInput {
  playback: PlaybackState;
  /** Server-aligned now (epoch ms). */
  serverNow: number;
  paused: boolean;
  currentTime: number;
  playbackRate: number;
  durationSec?: number;
  coolingDown: boolean;
  autoplayBlocked: boolean;
}

/**
 * Pure follower decision for a local `<video>`: hard seek above 1.5 s, gentle rate nudging
 * (1 ± 0.05) between 0.3 s and 1.5 s, and rate 1 once close again.
 */
export function decideLocalSync(i: LocalSyncInput): LocalSyncAction[] {
  const expected = expectedPosition(i.playback, i.serverNow, i.durationSec);
  const drift = i.currentTime - expected;
  const actions: LocalSyncAction[] = [];

  if (i.playback.status === 'paused') {
    if (!i.paused) actions.push({ type: 'pause' });
    if (i.playbackRate !== 1) actions.push({ type: 'rate', rate: 1 });
    if (!i.coolingDown && Math.abs(drift) > PAUSED_DRIFT_SEC) actions.push({ type: 'seek', to: expected });
    return actions;
  }

  if (i.paused && !i.autoplayBlocked) actions.push({ type: 'play' });
  if (Math.abs(drift) > HARD_SEEK_SEC) {
    if (!i.coolingDown) actions.push({ type: 'seek', to: expected });
    if (i.playbackRate !== 1) actions.push({ type: 'rate', rate: 1 });
  } else if (Math.abs(drift) > NUDGE_SEC) {
    const rate = drift > 0 ? 1 - NUDGE_RATE : 1 + NUDGE_RATE;
    if (i.playbackRate !== rate) actions.push({ type: 'rate', rate });
  } else if (i.playbackRate !== 1) {
    actions.push({ type: 'rate', rate: 1 });
  }
  return actions;
}

export interface LocalFollowerDeps {
  getVideo(): HTMLVideoElement | null;
  getPlayback(): PlaybackState;
  serverNow(): number;
  onAutoplayBlocked(blocked: boolean): void;
}

/** Keeps a follower's local video aligned with the host. Runs every second and on every `playback:state`. */
export class LocalFollowerSync {
  private timer: ReturnType<typeof setInterval> | null = null;
  private cooldownUntil = 0;
  private blocked = false;

  constructor(private readonly deps: LocalFollowerDeps) {}

  start(): void {
    this.stop();
    this.timer = setInterval(() => this.sync(), 1000);
    this.sync();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private setBlocked(blocked: boolean): void {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    this.deps.onAutoplayBlocked(blocked);
  }

  sync(): void {
    const video = this.deps.getVideo();
    if (!video || video.readyState < 1) return;
    const now = Date.now();
    const playback = this.deps.getPlayback();
    const actions = decideLocalSync({
      playback,
      serverNow: this.deps.serverNow(),
      paused: video.paused,
      currentTime: video.currentTime,
      playbackRate: video.playbackRate,
      durationSec: Number.isFinite(video.duration) ? video.duration : undefined,
      coolingDown: now < this.cooldownUntil,
      autoplayBlocked: this.blocked,
    });
    if (playback.status === 'paused') this.setBlocked(false);
    for (const action of actions) {
      if (action.type === 'pause') video.pause();
      else if (action.type === 'rate') video.playbackRate = action.rate;
      else if (action.type === 'seek') {
        video.currentTime = action.to;
        this.cooldownUntil = now + SEEK_COOLDOWN_MS;
      } else {
        video.play().then(
          () => this.setBlocked(false),
          () => this.setBlocked(true),
        );
      }
    }
  }

  /** Called from the "Tap to join" overlay, inside a user gesture. */
  resume(muted: boolean): void {
    const video = this.deps.getVideo();
    if (!video) return;
    video.muted = muted;
    this.setBlocked(false);
    this.sync();
    if (this.deps.getPlayback().status === 'playing') {
      video.play().catch(() => this.setBlocked(true));
    }
  }
}
