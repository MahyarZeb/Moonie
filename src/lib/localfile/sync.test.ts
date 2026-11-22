import { describe, expect, it } from 'vitest';
import type { PlaybackState } from '@shared/protocol';
import { LocalFileStore } from './LocalFileStore';
import { checkPlayable } from './support';
import { decideLocalSync, type LocalSyncInput } from './sync';

const playing: PlaybackState = { rev: 1, status: 'playing', positionSec: 10, updatedAt: 1000 };
const base = (over: Partial<LocalSyncInput> = {}): LocalSyncInput => ({
  playback: playing,
  serverNow: 3000, // expected position 12
  paused: false,
  currentTime: 12,
  playbackRate: 1,
  coolingDown: false,
  autoplayBlocked: false,
  ...over,
});

describe('decideLocalSync', () => {
  it('does nothing when in sync', () => {
    expect(decideLocalSync(base())).toEqual([]);
  });

  it('hard seeks above 1.5 s of drift', () => {
    expect(decideLocalSync(base({ currentTime: 9 }))).toEqual([{ type: 'seek', to: 12 }]);
  });

  it('does not seek again during the cool-down', () => {
    expect(decideLocalSync(base({ currentTime: 9, coolingDown: true }))).toEqual([]);
  });

  it('nudges the rate for drift between 0.3 s and 1.5 s', () => {
    expect(decideLocalSync(base({ currentTime: 11 }))).toEqual([{ type: 'rate', rate: 1.05 }]);
    expect(decideLocalSync(base({ currentTime: 13 }))).toEqual([{ type: 'rate', rate: 0.95 }]);
  });

  it('restores rate 1 once close', () => {
    expect(decideLocalSync(base({ playbackRate: 1.05, currentTime: 11.9 }))).toEqual([{ type: 'rate', rate: 1 }]);
  });

  it('plays when the host is playing, unless autoplay is blocked', () => {
    expect(decideLocalSync(base({ paused: true }))).toEqual([{ type: 'play' }]);
    expect(decideLocalSync(base({ paused: true, autoplayBlocked: true }))).toEqual([]);
  });

  it('pauses and aligns when the host is paused', () => {
    const paused: PlaybackState = { rev: 1, status: 'paused', positionSec: 30, updatedAt: 1000 };
    expect(decideLocalSync(base({ playback: paused, currentTime: 12 }))).toEqual([
      { type: 'pause' },
      { type: 'seek', to: 30 },
    ]);
  });
});

describe('LocalFileStore', () => {
  const file = new File([new Uint8Array(20)], 'clip.mp4', { type: 'video/mp4', lastModified: 7 });
  const make = (hash: string | null = 'a'.repeat(64)) => {
    const revoked: string[] = [];
    const store = new LocalFileStore({
      createUrl: () => `blob:test-${revoked.length}`,
      revokeUrl: (u) => revoked.push(u),
      check: (f) => checkPlayable(f, { canPlayType: () => 'maybe' }),
      readDuration: async () => 42,
      hash: async () => hash ?? undefined,
    });
    return { store, revoked };
  };

  it('builds metadata without any URL in it', async () => {
    const { store } = make();
    await store.pick(file);
    const s = store.getState();
    expect(s.status).toBe('ready');
    expect(s.meta).toEqual({
      name: 'clip.mp4',
      size: 20,
      lastModified: 7,
      mime: 'video/mp4',
      durationSec: 42,
      hash: 'a'.repeat(64),
    });
    expect(JSON.stringify(s.meta)).not.toContain('blob:');
  });

  it('omits the hash when it is unavailable', async () => {
    const { store } = make(null);
    await store.pick(file);
    expect(store.getState().meta).not.toHaveProperty('hash');
  });

  it('rejects non-video files and revokes the URL on clear', async () => {
    const { store, revoked } = make();
    await store.pick(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    expect(store.getState().status).toBe('error');
    await store.pick(file);
    store.clear();
    expect(revoked).toHaveLength(1);
    expect(store.getState().status).toBe('idle');
  });
});
