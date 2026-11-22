import { describe, expect, it } from 'vitest';
import { applyCommand, expectedPosition } from './playback';

const base = { rev: 3, status: 'paused' as const, positionSec: 5, updatedAt: 1000 };

describe('expectedPosition', () => {
  it('extrapolates only while playing', () => {
    expect(expectedPosition({ ...base, status: 'playing' }, 3000)).toBe(7);
    expect(expectedPosition(base, 3000)).toBe(5);
  });
  it('clamps to the duration', () => {
    expect(expectedPosition({ ...base, status: 'playing' }, 100000, 20)).toBe(20);
  });
});

describe('applyCommand', () => {
  it('play sets playing at the given position and keeps the rev', () => {
    expect(applyCommand(base, { action: 'play', positionSec: 12 }, 5000)).toEqual({
      rev: 3,
      status: 'playing',
      positionSec: 12,
      updatedAt: 5000,
    });
  });
  it('pause sets paused', () => {
    const playing = { ...base, status: 'playing' as const };
    expect(applyCommand(playing, { action: 'pause', positionSec: 9 }, 5000).status).toBe('paused');
  });
  it('seek keeps the current status', () => {
    expect(applyCommand(base, { action: 'seek', positionSec: 40 }, 5000).status).toBe('paused');
    const playing = { ...base, status: 'playing' as const };
    expect(applyCommand(playing, { action: 'seek', positionSec: 40 }, 5000).status).toBe('playing');
  });
  it('uses the host measurement time within 2 s', () => {
    expect(applyCommand(base, { action: 'play', positionSec: 1, hostServerTime: 4400 }, 5000).updatedAt).toBe(4400);
  });
  it('clamps an old or future host time', () => {
    expect(applyCommand(base, { action: 'play', positionSec: 1, hostServerTime: 100 }, 5000).updatedAt).toBe(3000);
    expect(applyCommand(base, { action: 'play', positionSec: 1, hostServerTime: 99999 }, 5000).updatedAt).toBe(5000);
  });
});
