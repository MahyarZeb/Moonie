import { describe, expect, it } from 'vitest';
import { decideSync, detectSeek, type SyncInput } from './syncController';
import { describeYouTubeError } from './errors';
import { YT_STATE } from './types';

const playing = { rev: 1, status: 'playing' as const, positionSec: 10, updatedAt: 1000 };
const paused = { ...playing, status: 'paused' as const };

const input = (over: Partial<SyncInput>): SyncInput => ({
  playback: playing,
  serverNow: 3000, // expected position 12
  playerState: YT_STATE.PLAYING,
  currentTime: 12,
  coolingDown: false,
  autoplayBlocked: false,
  ...over,
});

describe('decideSync', () => {
  it('does nothing when in sync', () => expect(decideSync(input({}))).toEqual([]));
  it('tolerates drift up to 1.5 s', () => expect(decideSync(input({ currentTime: 10.6 }))).toEqual([]));
  it('seeks to the expected position when drift is above 1.5 s', () => {
    expect(decideSync(input({ currentTime: 9 }))).toEqual([{ type: 'seek', to: 12 }]);
    expect(decideSync(input({ currentTime: 15 }))).toEqual([{ type: 'seek', to: 12 }]);
  });
  it('does not seek during the cool-down', () => {
    expect(decideSync(input({ currentTime: 3, coolingDown: true }))).toEqual([]);
  });
  it('skips everything while buffering', () => {
    expect(decideSync(input({ playerState: YT_STATE.BUFFERING, currentTime: 0 }))).toEqual([]);
  });
  it('plays when the host is playing and the player is paused or cued', () => {
    expect(decideSync(input({ playerState: YT_STATE.PAUSED }))).toEqual([{ type: 'play' }]);
    expect(decideSync(input({ playerState: YT_STATE.CUED }))).toEqual([{ type: 'play' }]);
  });
  it('does not retry play while autoplay is blocked', () => {
    expect(decideSync(input({ playerState: YT_STATE.PAUSED, autoplayBlocked: true }))).toEqual([]);
  });
  it('pauses a playing follower when the host paused', () => {
    expect(decideSync(input({ playback: paused, playerState: YT_STATE.PLAYING, currentTime: 10 }))).toEqual([
      { type: 'pause' },
    ]);
  });
  it('aligns a paused follower to the host position', () => {
    expect(decideSync(input({ playback: paused, playerState: YT_STATE.PAUSED, currentTime: 20 }))).toEqual([
      { type: 'seek', to: 10 },
    ]);
  });
  it('never extrapolates past the duration', () => {
    expect(decideSync(input({ serverNow: 100000, durationSec: 30, currentTime: 30 }))).toEqual([]);
  });
});

describe('detectSeek', () => {
  it('is false for normal progress while playing', () => {
    expect(detectSeek({ lastPos: 10, elapsedMs: 500, currentTime: 10.5, playing: true })).toBe(false);
  });
  it('is true for a jump above 1 s while playing', () => {
    expect(detectSeek({ lastPos: 10, elapsedMs: 500, currentTime: 30, playing: true })).toBe(true);
    expect(detectSeek({ lastPos: 10, elapsedMs: 500, currentTime: 2, playing: true })).toBe(true);
  });
  it('is true for any move while paused', () => {
    expect(detectSeek({ lastPos: 10, elapsedMs: 500, currentTime: 11, playing: false })).toBe(true);
    expect(detectSeek({ lastPos: 10, elapsedMs: 500, currentTime: 10, playing: false })).toBe(false);
  });
});

describe('describeYouTubeError', () => {
  it.each([2, 5, 100, 101, 150, 999])('has text for code %i', (code) => {
    expect(describeYouTubeError(code).length).toBeGreaterThan(10);
  });
  it('explains embedding restrictions for 101 and 150', () => {
    expect(describeYouTubeError(101)).toBe(describeYouTubeError(150));
    expect(describeYouTubeError(150)).toMatch(/embedding/);
  });
});
