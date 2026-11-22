import type { PlaybackState } from './protocol';

/** Where the media should be at server time `now`, given a stored playback state. */
export function expectedPosition(playback: PlaybackState, now: number, durationSec?: number): number {
  let pos = playback.positionSec;
  if (playback.status === 'playing') pos += Math.max(0, now - playback.updatedAt) / 1000;
  if (durationSec !== undefined) pos = Math.min(pos, durationSec);
  return Math.max(0, pos);
}
