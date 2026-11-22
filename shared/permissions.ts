// Room permission rules. Pure TS, shared by the signaling server (enforcement) and the UI (showing controls).

import type { Role, RoomSettings } from './protocol';

export const DEFAULT_SETTINGS: RoomSettings = {
  requireApproval: true,
  autoNext: true,
  coHostsCanKick: true,
};

export type Action =
  | 'room.settings'
  | 'room.roles'
  | 'host.transfer'
  | 'member.kick'
  | 'playback.control'
  | 'media.set'
  | 'media.share.start'
  | 'media.share.stop'
  | 'queue.add'
  | 'queue.manage'
  | 'queue.remove.own'
  | 'chat.send'
  | 'chat.moderate'
  | 'game.play'
  | 'game.manage'
  | 'reaction.send';

export const ACTIONS: readonly Action[] = [
  'room.settings',
  'room.roles',
  'host.transfer',
  'member.kick',
  'playback.control',
  'media.set',
  'media.share.start',
  'media.share.stop',
  'queue.add',
  'queue.manage',
  'queue.remove.own',
  'chat.send',
  'chat.moderate',
  'game.play',
  'game.manage',
  'reaction.send',
];

/** Actions only the host may perform. */
const HOST_ONLY: ReadonlySet<Action> = new Set<Action>(['room.settings', 'room.roles', 'host.transfer']);
/** Actions the host and co-hosts may perform. */
const CONTROLLER: ReadonlySet<Action> = new Set<Action>([
  'playback.control',
  'media.set',
  'media.share.start',
  'media.share.stop',
  'queue.manage',
  'chat.moderate',
  'game.manage',
]);

/** True when `role` holds `action`. Chat mute is a per-participant state and is checked by the caller. */
export function can(role: Role, action: Action, settings: RoomSettings): boolean {
  if (role === 'host') return true;
  if (HOST_ONLY.has(action)) return false;
  if (action === 'member.kick') return role === 'co_host' && settings.coHostsCanKick;
  if (CONTROLLER.has(action)) return role === 'co_host';
  return true;
}

/** Host or co-host: may drive playback, the queue, shares, games and chat moderation. */
export const isController = (role: Role): boolean => role === 'host' || role === 'co_host';

/**
 * True when `actor` may apply `action` to a participant holding `target` (kick, mute, role changes, transfer).
 * Nobody can act on the host. A co-host can only act on members. `self` blocks acting on yourself.
 * Actions without a target fall back to `can`.
 */
export function canActOn(
  actor: Role,
  target: Role,
  action: Action,
  settings: RoomSettings,
  self = false,
): boolean {
  if (!can(actor, action, settings)) return false;
  if (action !== 'member.kick' && action !== 'chat.moderate' && action !== 'room.roles' && action !== 'host.transfer') {
    return true;
  }
  if (target === 'host') return false;
  if (self && action !== 'chat.moderate') return false;
  if (actor === 'co_host' && target !== 'member') return false;
  return true;
}
