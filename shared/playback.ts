import type { PlaybackState } from './protocol';

/** Where the media should be at server time `now`, given a stored playback state. */
export function expectedPosition(playback: PlaybackState, now: number, durationSec?: number): number {
  let pos = playback.positionSec;
  if (playback.status === 'playing') pos += Math.max(0, now - playback.updatedAt) / 1000;
  if (durationSec !== undefined) pos = Math.min(pos, durationSec);
  return Math.max(0, pos);
}

/** How far into the past a host-reported measurement time may reach. */
export const MAX_HOST_LAG_MS = 2000;

export interface PlaybackCommand {
  action: 'play' | 'pause' | 'seek';
  positionSec: number;
  hostServerTime?: number;
}

/**
 * Applies a host command to a playback state. `rev` is kept (it always equals `media.rev`).
 * `updatedAt` is the host's measurement time clamped to `[now - 2 s, now]`, which removes the
 * host's uplink delay from the timeline without trusting a wild timestamp.
 */
export function applyCommand(playback: PlaybackState, cmd: PlaybackCommand, now: number): PlaybackState {
  const measured = cmd.hostServerTime ?? now;
  const updatedAt = Math.min(now, Math.max(now - MAX_HOST_LAG_MS, measured));
  const status = cmd.action === 'play' ? 'playing' : cmd.action === 'pause' ? 'paused' : playback.status;
  return { rev: playback.rev, status, positionSec: cmd.positionSec, updatedAt };
}
