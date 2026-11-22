import { expectedPosition } from '@shared/playback';
import type { PlaybackState } from '@shared/protocol';
import { YT_STATE, type YTPlayer } from './types';

export const DRIFT_THRESHOLD_SEC = 1.5;
const PAUSED_DRIFT_SEC = 0.5;
const SEEK_JUMP_SEC = 1.0;
const SUPPRESS_MS = 750;
const SEEK_COOLDOWN_MS = 1500;
const AUTOPLAY_BLOCK_MS = 2500;

export type SyncAction = { type: 'play' } | { type: 'pause' } | { type: 'seek'; to: number };

export interface SyncInput {
  playback: PlaybackState;
  /** Server-aligned now (epoch ms). */
  serverNow: number;
  playerState: number;
  currentTime: number;
  durationSec?: number;
  /** True while a recent programmatic seek is still settling. */
  coolingDown: boolean;
  /** True when the browser blocked autoplay and the user has not tapped yet. */
  autoplayBlocked: boolean;
}

/** Pure follower decision: what to do to make the local player match the host's playback state. */
export function decideSync(i: SyncInput): SyncAction[] {
  if (i.playerState === YT_STATE.BUFFERING) return [];
  const expected = expectedPosition(i.playback, i.serverNow, i.durationSec);
  const drift = i.currentTime - expected;
  const actions: SyncAction[] = [];

  if (i.playback.status === 'paused') {
    if (i.playerState === YT_STATE.PLAYING) actions.push({ type: 'pause' });
    if (!i.coolingDown && Math.abs(drift) > PAUSED_DRIFT_SEC) actions.push({ type: 'seek', to: expected });
    return actions;
  }

  const notPlaying =
    i.playerState === YT_STATE.PAUSED || i.playerState === YT_STATE.CUED || i.playerState === YT_STATE.UNSTARTED;
  if (notPlaying && !i.autoplayBlocked) actions.push({ type: 'play' });
  if (!i.coolingDown && Math.abs(drift) > DRIFT_THRESHOLD_SEC && i.playerState !== YT_STATE.ENDED) {
    actions.push({ type: 'seek', to: expected });
  }
  return actions;
}

export interface SeekDetectInput {
  /** Position at the previous poll, and how many ms ago it was taken. */
  lastPos: number;
  elapsedMs: number;
  currentTime: number;
  playing: boolean;
}

/**
 * Host-side seek detection. While playing, the position should have advanced by the elapsed time,
 * and a jump above 1 s means a seek. While paused, any move means a seek.
 */
export function detectSeek(i: SeekDetectInput): boolean {
  if (i.playing) return Math.abs(i.currentTime - (i.lastPos + i.elapsedMs / 1000)) > SEEK_JUMP_SEC;
  return Math.abs(i.currentTime - i.lastPos) > 0.25;
}

export interface FollowerDeps {
  getPlayer(): YTPlayer | null;
  getPlayback(): PlaybackState;
  serverNow(): number;
  onAutoplayBlocked(blocked: boolean): void;
}

/**
 * Keeps a follower's player aligned with the host. Runs every second and whenever a
 * `playback:state` arrives. It reads the room store imperatively, never through React state.
 */
export class FollowerSync {
  private timer: ReturnType<typeof setInterval> | null = null;
  private suppressUntil = 0;
  private cooldownUntil = 0;
  private playRequestedAt: number | null = null;
  private blocked = false;

  constructor(private readonly deps: FollowerDeps) {}

  start(): void {
    this.stop();
    this.timer = setInterval(() => this.sync(), 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** True while our own seek/play/pause calls are still echoing back as player events. */
  get suppressed(): boolean {
    return Date.now() < this.suppressUntil;
  }

  /** Call when the media changes: forget cool-downs and blocked state. */
  reset(): void {
    this.suppressUntil = Date.now() + SUPPRESS_MS;
    this.cooldownUntil = 0;
    this.playRequestedAt = null;
    this.setBlocked(false);
  }

  noteState(state: number): void {
    if (state === YT_STATE.PLAYING) {
      this.playRequestedAt = null;
      this.setBlocked(false);
    }
  }

  private setBlocked(blocked: boolean): void {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    this.deps.onAutoplayBlocked(blocked);
  }

  sync(): void {
    const player = this.deps.getPlayer();
    if (!player) return;
    const now = Date.now();
    const playback = this.deps.getPlayback();
    const duration = player.getDuration();
    const actions = decideSync({
      playback,
      serverNow: this.deps.serverNow(),
      playerState: player.getPlayerState(),
      currentTime: player.getCurrentTime(),
      durationSec: duration > 0 ? duration : undefined,
      coolingDown: now < this.cooldownUntil,
      autoplayBlocked: this.blocked,
    });

    if (playback.status === 'paused') {
      this.playRequestedAt = null;
      this.setBlocked(false);
    }
    for (const action of actions) {
      this.suppressUntil = now + SUPPRESS_MS;
      if (action.type === 'pause') player.pauseVideo();
      else if (action.type === 'seek') {
        player.seekTo(action.to, true);
        this.cooldownUntil = now + SEEK_COOLDOWN_MS;
      } else {
        player.playVideo();
        this.playRequestedAt ??= now;
      }
    }
    if (this.playRequestedAt !== null && now - this.playRequestedAt > AUTOPLAY_BLOCK_MS) this.setBlocked(true);
  }

  /** Called from the "Tap to join" overlay, inside a user gesture. */
  resume(muted: boolean): void {
    const player = this.deps.getPlayer();
    if (!player) return;
    if (muted) player.mute();
    else player.unMute();
    this.playRequestedAt = null;
    this.setBlocked(false);
    this.suppressUntil = Date.now() + SUPPRESS_MS;
    player.playVideo();
    this.sync();
  }
}
