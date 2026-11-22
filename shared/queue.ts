// Queue and suggestion rules as pure functions: (state, context, command) -> result.
// No sockets, clocks or randomness here; the caller injects them. The signaling server (or any other
// transport) applies the result and publishes it, so the transport can change without touching these rules.

import { LIMITS } from './constants';
import { can } from './permissions';
import type { ErrorCode, QueueItem, Role, RoomSettings } from './protocol';

export interface QueueState {
  /** Approved videos, played in order. */
  queue: QueueItem[];
  /** Member videos waiting for a host or co-host. */
  suggestions: QueueItem[];
}

export interface QueueContext {
  actorId: string;
  /** Always the server-held role, never read from a client message. */
  role: Role;
  settings: RoomSettings;
  /** Video id of the YouTube video that is playing now, if any. */
  currentVideoId: string | null;
  /** Nothing is playing and nobody is sharing. */
  idle: boolean;
  now: number;
  newId: () => string;
}

export type QueueEffect =
  /** Tell the room someone added a video. `suggested` goes to controllers only. */
  | { type: 'notice'; kind: 'added' | 'suggested'; item: QueueItem }
  /** Start this item as the current video. It is already removed from the queue. */
  | { type: 'start'; item: QueueItem }
  /** End playback (media becomes null). */
  | { type: 'stop' };

export type QueueFail = { ok: false; code: ErrorCode; message: string };
export type QueueOk = { ok: true; state: QueueState; effects: QueueEffect[] };
export type QueueResult = QueueOk | QueueFail;

const fail = (code: ErrorCode, message: string): QueueFail => ({ ok: false, code, message });
const done = (state: QueueState, effects: QueueEffect[] = []): QueueOk => ({ ok: true, state, effects });

export const emptyQueueState = (): QueueState => ({ queue: [], suggestions: [] });

const isManager = (ctx: QueueContext): boolean => can(ctx.role, 'queue.manage', ctx.settings);

/**
 * Adds a video. Host and co-host adds go straight to the queue (an idle room starts it, as before).
 * A member add goes to the suggestions when approval is required, otherwise to the queue. A member add
 * never starts or interrupts playback.
 */
export function addVideo(state: QueueState, ctx: QueueContext, videoId: string, title: string | undefined): QueueResult {
  if (!can(ctx.role, 'queue.add', ctx.settings)) return fail('forbidden', 'You cannot add videos');
  if (
    ctx.currentVideoId === videoId ||
    state.queue.some((q) => q.videoId === videoId) ||
    state.suggestions.some((q) => q.videoId === videoId)
  ) {
    return fail('invalid_state', 'That video is already in the queue');
  }
  const item: QueueItem = { id: ctx.newId(), videoId, ...(title ? { title } : {}), addedBy: ctx.actorId, addedAt: ctx.now };
  const manager = isManager(ctx);
  if (!manager && ctx.settings.requireApproval) {
    if (state.suggestions.length >= LIMITS.suggestionsMax) return fail('invalid_state', 'There are too many suggestions waiting');
    if (state.suggestions.filter((q) => q.addedBy === ctx.actorId).length >= LIMITS.suggestionsPerUser) {
      return fail('forbidden', `You can have up to ${LIMITS.suggestionsPerUser} suggestions waiting`);
    }
    return done({ ...state, suggestions: [...state.suggestions, item] }, [{ type: 'notice', kind: 'suggested', item }]);
  }
  if (state.queue.length >= LIMITS.queueMax) return fail('invalid_state', 'The queue is full');
  if (state.queue.filter((q) => q.addedBy === ctx.actorId).length >= LIMITS.queuePerUser) {
    return fail('forbidden', `You can have up to ${LIMITS.queuePerUser} videos waiting in the queue`);
  }
  if (manager && ctx.idle && state.queue.length === 0) {
    return done(state, [{ type: 'start', item }, { type: 'notice', kind: 'added', item }]);
  }
  return done({ ...state, queue: [...state.queue, item] }, [{ type: 'notice', kind: 'added', item }]);
}

/** Moves a suggestion into the queue (at the end, or first in line). Never starts playback. */
export function approve(state: QueueState, ctx: QueueContext, itemId: string, position: 'end' | 'next' = 'end'): QueueResult {
  if (!isManager(ctx)) return fail('not_host', 'Only the host or a co-host can approve videos');
  const item = state.suggestions.find((q) => q.id === itemId);
  if (!item) return fail('not_found', 'That suggestion is gone');
  if (state.queue.length >= LIMITS.queueMax) return fail('invalid_state', 'The queue is full');
  const queue = position === 'next' ? [item, ...state.queue] : [...state.queue, item];
  return done({ queue, suggestions: state.suggestions.filter((q) => q.id !== itemId) });
}

/** Removes an item from the queue or the suggestions (reject). Managers remove any; others only their own. */
export function removeItem(state: QueueState, ctx: QueueContext, itemId: string): QueueResult {
  const item = state.queue.find((q) => q.id === itemId) ?? state.suggestions.find((q) => q.id === itemId);
  if (!item) return fail('not_found', 'That video is no longer in the queue');
  if (!isManager(ctx) && item.addedBy !== ctx.actorId) {
    return fail('forbidden', 'Only a host, a co-host or the person who added it can remove it');
  }
  return done({
    queue: state.queue.filter((q) => q.id !== itemId),
    suggestions: state.suggestions.filter((q) => q.id !== itemId),
  });
}

/** Moves a queue item. Returns the same `state` object when the position does not change. */
export function reorder(state: QueueState, ctx: QueueContext, itemId: string, toIndex: number): QueueResult {
  if (!isManager(ctx)) return fail('not_host', 'Only the host or a co-host can reorder the queue');
  const from = state.queue.findIndex((q) => q.id === itemId);
  if (from < 0) return fail('not_found', 'That video is no longer in the queue');
  const to = Math.max(0, Math.min(state.queue.length - 1, toIndex));
  if (to === from) return done(state);
  const queue = [...state.queue];
  const [item] = queue.splice(from, 1);
  queue.splice(to, 0, item!);
  return done({ ...state, queue });
}

/** Plays a queue item now. */
export function playItem(state: QueueState, ctx: QueueContext, itemId: string): QueueResult {
  if (!isManager(ctx)) return fail('not_host', 'Only the host or a co-host can start a queued video');
  const item = state.queue.find((q) => q.id === itemId);
  if (!item) return fail('not_found', 'That video is no longer in the queue');
  return done({ ...state, queue: state.queue.filter((q) => q.id !== itemId) }, [{ type: 'start', item }]);
}

/** Plays the next queue item, or ends playback when the queue is empty (no-op when idle). */
export function skip(state: QueueState, ctx: QueueContext): QueueResult {
  if (!isManager(ctx)) return fail('not_host', 'Only the host or a co-host can skip');
  const [next, ...rest] = state.queue;
  if (next) return done({ ...state, queue: rest }, [{ type: 'start', item: next }]);
  return done(state, ctx.idle ? [] : [{ type: 'stop' }]);
}

/**
 * The current video ended. With auto-next on and a queued item, that item starts. Otherwise nothing
 * starts and the caller pauses at the end. Not permission checked: the caller validates the reporter.
 */
export function finish(state: QueueState, settings: RoomSettings): QueueOk {
  const [next, ...rest] = state.queue;
  if (!settings.autoNext || !next) return done(state);
  return done({ ...state, queue: rest }, [{ type: 'start', item: next }]);
}

/** Sets the resolved title on every queued or suggested item for `videoId`. Same object when nothing changed. */
export function applyTitle(state: QueueState, videoId: string, title: string): QueueState {
  const patch = (items: QueueItem[]): QueueItem[] =>
    items.some((q) => q.videoId === videoId && q.title !== title)
      ? items.map((q) => (q.videoId === videoId ? { ...q, title } : q))
      : items;
  const queue = patch(state.queue);
  const suggestions = patch(state.suggestions);
  return queue === state.queue && suggestions === state.suggestions ? state : { queue, suggestions };
}
