import { describe, expect, it } from 'vitest';
import { ACTIONS, DEFAULT_SETTINGS, can, canActOn, isController, type Action } from './permissions';
import type { Role, RoomSettings } from './protocol';

const ROLE_LIST: Role[] = ['host', 'co_host', 'member'];

// [action, host, co_host, member] with default settings (coHostsCanKick on).
const MATRIX: [Action, boolean, boolean, boolean][] = [
  ['room.settings', true, false, false],
  ['room.roles', true, false, false],
  ['host.transfer', true, false, false],
  ['member.kick', true, true, false],
  ['playback.control', true, true, false],
  ['media.set', true, true, false],
  ['media.share.start', true, true, false],
  ['media.share.stop', true, true, false],
  ['queue.add', true, true, true],
  ['queue.manage', true, true, false],
  ['queue.remove.own', true, true, true],
  ['chat.send', true, true, true],
  ['chat.moderate', true, true, false],
  ['game.play', true, true, true],
  ['game.manage', true, true, false],
  ['reaction.send', true, true, true],
];

describe('can', () => {
  it.each(MATRIX)('%s: host=%s co_host=%s member=%s', (action, host, coHost, member) => {
    expect(can('host', action, DEFAULT_SETTINGS)).toBe(host);
    expect(can('co_host', action, DEFAULT_SETTINGS)).toBe(coHost);
    expect(can('member', action, DEFAULT_SETTINGS)).toBe(member);
  });

  it('covers every action in the matrix', () => {
    expect(MATRIX.map((r) => r[0]).sort()).toEqual([...ACTIONS].sort());
  });

  it('defaults: approval on, auto-next on, co-host kick on', () => {
    expect(DEFAULT_SETTINGS).toEqual({ requireApproval: true, autoNext: true, coHostsCanKick: true });
  });

  it('coHostsCanKick off removes only the co-host kick right', () => {
    const s: RoomSettings = { ...DEFAULT_SETTINGS, coHostsCanKick: false };
    expect(can('co_host', 'member.kick', s)).toBe(false);
    expect(can('host', 'member.kick', s)).toBe(true);
    for (const [action, , coHost] of MATRIX) {
      if (action !== 'member.kick') expect(can('co_host', action, s)).toBe(coHost);
    }
  });

  it('requireApproval and autoNext do not change any permission', () => {
    for (const requireApproval of [true, false]) {
      for (const autoNext of [true, false]) {
        const s: RoomSettings = { ...DEFAULT_SETTINGS, requireApproval, autoNext };
        for (const [action, host, coHost, member] of MATRIX) {
          expect([can('host', action, s), can('co_host', action, s), can('member', action, s)]).toEqual([host, coHost, member]);
        }
      }
    }
  });
});

describe('isController', () => {
  it('is true for host and co-host only', () => {
    expect(ROLE_LIST.map(isController)).toEqual([true, true, false]);
  });
});

describe('canActOn', () => {
  const S = DEFAULT_SETTINGS;

  it('nobody can kick, mute or change the role of the host', () => {
    for (const actor of ROLE_LIST) {
      for (const action of ['member.kick', 'chat.moderate', 'room.roles', 'host.transfer'] as const) {
        expect(canActOn(actor, 'host', action, S)).toBe(false);
      }
    }
  });

  it('host can act on co-hosts and members', () => {
    for (const target of ['co_host', 'member'] as const) {
      for (const action of ['member.kick', 'chat.moderate', 'room.roles', 'host.transfer'] as const) {
        expect(canActOn('host', target, action, S)).toBe(true);
      }
    }
  });

  it('co-host can kick and mute members only', () => {
    expect(canActOn('co_host', 'member', 'member.kick', S)).toBe(true);
    expect(canActOn('co_host', 'member', 'chat.moderate', S)).toBe(true);
    expect(canActOn('co_host', 'co_host', 'member.kick', S)).toBe(false);
    expect(canActOn('co_host', 'co_host', 'chat.moderate', S)).toBe(false);
  });

  it('co-host cannot manage roles or transfer, even for members', () => {
    expect(canActOn('co_host', 'member', 'room.roles', S)).toBe(false);
    expect(canActOn('co_host', 'member', 'host.transfer', S)).toBe(false);
  });

  it('co-host kick respects coHostsCanKick', () => {
    expect(canActOn('co_host', 'member', 'member.kick', { ...S, coHostsCanKick: false })).toBe(false);
    expect(canActOn('co_host', 'member', 'chat.moderate', { ...S, coHostsCanKick: false })).toBe(true);
  });

  it('members can act on nobody', () => {
    for (const target of ROLE_LIST) {
      for (const action of ['member.kick', 'chat.moderate', 'room.roles', 'host.transfer'] as const) {
        expect(canActOn('member', target, action, S)).toBe(false);
      }
    }
  });

  it('self actions are blocked for kick, roles and transfer', () => {
    expect(canActOn('host', 'member', 'member.kick', S, true)).toBe(false);
    expect(canActOn('host', 'member', 'host.transfer', S, true)).toBe(false);
  });

  it('actions without a target fall back to can', () => {
    for (const [action] of MATRIX) {
      if (['member.kick', 'chat.moderate', 'room.roles', 'host.transfer'].includes(action)) continue;
      for (const role of ROLE_LIST) {
        expect(canActOn(role, 'host', action, S)).toBe(can(role, action, S));
      }
    }
  });
});
