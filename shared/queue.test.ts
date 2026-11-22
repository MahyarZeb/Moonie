import { describe, expect, it } from 'vitest';
import { LIMITS } from './constants';
import { DEFAULT_SETTINGS } from './permissions';
import type { QueueItem, Role, RoomSettings } from './protocol';
import {
  addVideo,
  applyTitle,
  approve,
  emptyQueueState,
  finish,
  playItem,
  removeItem,
  reorder,
  skip,
  type QueueContext,
  type QueueState,
} from './queue';

let n = 0;
const ctx = (role: Role, over: Partial<QueueContext> = {}, settings: Partial<RoomSettings> = {}): QueueContext => ({
  actorId: role,
  role,
  settings: { ...DEFAULT_SETTINGS, ...settings },
  currentVideoId: null,
  idle: false,
  now: 1000,
  newId: () => `id${++n}`,
  ...over,
});
const vid = (i: number) => String(i).padStart(11, 'a');
const item = (i: number, addedBy = 'host'): QueueItem => ({ id: `q${i}`, videoId: vid(i), addedBy, addedAt: 1 });
const state = (queue: QueueItem[] = [], suggestions: QueueItem[] = []): QueueState => ({ queue, suggestions });
const ok = <T extends { ok: boolean }>(r: T) => {
  expect(r.ok).toBe(true);
  return r as Extract<T, { ok: true }>;
};

describe('addVideo', () => {
  it('a member add becomes a suggestion when approval is required, and never starts playback', () => {
    const r = ok(addVideo(emptyQueueState(), ctx('member', { idle: true }), vid(1), 'T'));
    expect(r.state.queue).toEqual([]);
    expect(r.state.suggestions).toMatchObject([{ videoId: vid(1), title: 'T', addedBy: 'member' }]);
    expect(r.effects.map((e) => e.type)).toEqual(['notice']);
    expect(r.effects[0]).toMatchObject({ kind: 'suggested' });
  });

  it('a member add with approval off goes to the queue and still never starts playback', () => {
    const r = ok(addVideo(emptyQueueState(), ctx('member', { idle: true }, { requireApproval: false }), vid(1), undefined));
    expect(r.state.queue).toHaveLength(1);
    expect(r.effects.some((e) => e.type === 'start')).toBe(false);
    expect(r.effects[0]).toMatchObject({ kind: 'added' });
  });

  it('host and co-host adds go straight to the queue', () => {
    for (const role of ['host', 'co_host'] as const) {
      const r = ok(addVideo(emptyQueueState(), ctx(role), vid(1), undefined));
      expect(r.state.queue).toHaveLength(1);
      expect(r.state.suggestions).toHaveLength(0);
    }
  });

  it('a controller add in an idle room starts the video', () => {
    const r = ok(addVideo(emptyQueueState(), ctx('co_host', { idle: true }), vid(1), undefined));
    expect(r.state.queue).toEqual([]);
    expect(r.effects[0]).toMatchObject({ type: 'start', item: { videoId: vid(1) } });
  });

  it('a controller add in an idle room with a non-empty queue just queues', () => {
    const r = ok(addVideo(state([item(1)]), ctx('host', { idle: true }), vid(2), undefined));
    expect(r.state.queue).toHaveLength(2);
    expect(r.effects.some((e) => e.type === 'start')).toBe(false);
  });

  it('rejects duplicates of the current video, the queue and the suggestions', () => {
    const s = state([item(1)], [item(2)]);
    for (const [id, current] of [[vid(1), null], [vid(2), null], [vid(3), vid(3)]] as const) {
      const r = addVideo(s, ctx('host', { currentVideoId: current }), id, undefined);
      expect(r).toMatchObject({ ok: false, code: 'invalid_state' });
    }
  });

  it('enforces the suggestion limits (per user and total) and the queue limits', () => {
    const mine = Array.from({ length: LIMITS.suggestionsPerUser }, (_, i) => item(i, 'member'));
    expect(addVideo(state([], mine), ctx('member'), vid(99), undefined)).toMatchObject({ ok: false, code: 'forbidden' });
    const many = Array.from({ length: LIMITS.suggestionsMax }, (_, i) => item(i, `u${i}`));
    expect(addVideo(state([], many), ctx('member'), vid(99), undefined)).toMatchObject({ ok: false, code: 'invalid_state' });
    const full = Array.from({ length: LIMITS.queueMax }, (_, i) => item(i, `u${i}`));
    expect(addVideo(state(full), ctx('host'), vid(99), undefined)).toMatchObject({ ok: false, code: 'invalid_state' });
    const own = Array.from({ length: LIMITS.queuePerUser }, (_, i) => item(i, 'host'));
    expect(addVideo(state(own), ctx('host'), vid(99), undefined)).toMatchObject({ ok: false, code: 'forbidden' });
  });
});

describe('approve and remove', () => {
  it('approve moves a suggestion to the end or the front and never plays', () => {
    const s = state([item(1)], [item(2, 'member'), item(3, 'member')]);
    const end = ok(approve(s, ctx('co_host', { idle: true }), 'q2'));
    expect(end.state.queue.map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(end.state.suggestions.map((q) => q.id)).toEqual(['q3']);
    expect(end.effects).toEqual([]);
    const next = ok(approve(s, ctx('host'), 'q3', 'next'));
    expect(next.state.queue.map((q) => q.id)).toEqual(['q3', 'q1']);
  });

  it('members cannot approve; unknown ids and a full queue fail', () => {
    const s = state([], [item(2, 'member')]);
    expect(approve(s, ctx('member'), 'q2')).toMatchObject({ ok: false, code: 'not_host' });
    expect(approve(s, ctx('host'), 'nope')).toMatchObject({ ok: false, code: 'not_found' });
    const full = Array.from({ length: LIMITS.queueMax }, (_, i) => item(i, `u${i}`));
    expect(approve(state(full, [item(60, 'member')]), ctx('host'), 'q60')).toMatchObject({ ok: false, code: 'invalid_state' });
  });

  it('managers remove or reject anything; members only their own', () => {
    const s = state([item(1, 'a')], [item(2, 'member')]);
    expect(ok(removeItem(s, ctx('co_host'), 'q1')).state.queue).toEqual([]);
    expect(ok(removeItem(s, ctx('host'), 'q2')).state.suggestions).toEqual([]);
    expect(ok(removeItem(s, ctx('member'), 'q2')).state.suggestions).toEqual([]);
    expect(removeItem(s, ctx('member'), 'q1')).toMatchObject({ ok: false, code: 'forbidden' });
    expect(removeItem(s, ctx('member'), 'zz')).toMatchObject({ ok: false, code: 'not_found' });
  });
});

describe('reorder, play, skip, finish', () => {
  const s = state([item(1), item(2), item(3)]);

  it('reorder clamps, is a no-op in place, and is manager only', () => {
    expect(ok(reorder(s, ctx('host'), 'q1', 99)).state.queue.map((q) => q.id)).toEqual(['q2', 'q3', 'q1']);
    const same = ok(reorder(s, ctx('co_host'), 'q2', 1));
    expect(same.state).toBe(s);
    expect(reorder(s, ctx('member'), 'q1', 1)).toMatchObject({ ok: false, code: 'not_host' });
  });

  it('play removes the item and starts it', () => {
    const r = ok(playItem(s, ctx('co_host'), 'q2'));
    expect(r.state.queue.map((q) => q.id)).toEqual(['q1', 'q3']);
    expect(r.effects).toEqual([{ type: 'start', item: s.queue[1] }]);
    expect(playItem(s, ctx('member'), 'q2')).toMatchObject({ ok: false, code: 'not_host' });
  });

  it('skip starts the head, stops when the queue is empty, and is a no-op when idle', () => {
    expect(ok(skip(s, ctx('host'))).effects).toEqual([{ type: 'start', item: s.queue[0] }]);
    expect(ok(skip(state(), ctx('host'))).effects).toEqual([{ type: 'stop' }]);
    expect(ok(skip(state(), ctx('host', { idle: true }))).effects).toEqual([]);
    expect(skip(s, ctx('member'))).toMatchObject({ ok: false, code: 'not_host' });
  });

  it('finish advances only with autoNext on', () => {
    expect(finish(s, { ...DEFAULT_SETTINGS, autoNext: true }).effects).toEqual([{ type: 'start', item: s.queue[0] }]);
    const off = finish(s, { ...DEFAULT_SETTINGS, autoNext: false });
    expect(off.effects).toEqual([]);
    expect(off.state).toBe(s);
    expect(finish(state(), DEFAULT_SETTINGS).effects).toEqual([]);
  });
});

describe('applyTitle', () => {
  it('sets the title on matching items in both lists and returns the same state when unchanged', () => {
    const s = state([{ ...item(1), title: 'hint' }], [item(1, 'm')]);
    const next = applyTitle(s, vid(1), 'Real');
    expect(next.queue[0]!.title).toBe('Real');
    expect(next.suggestions[0]!.title).toBe('Real');
    expect(applyTitle(next, vid(1), 'Real')).toBe(next);
    expect(applyTitle(s, vid(7), 'x')).toBe(s);
  });
});
