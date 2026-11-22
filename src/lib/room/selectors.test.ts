import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/permissions';
import type { Participant, RoomSnapshot } from '@shared/protocol';
import { initialRoomState, type RoomClientState } from './reducer';
import { selectCan, selectIsController, selectSelfRole } from './selectors';

const part = (id: string, role: Participant['role']): Participant => ({ id, name: id, avatar: 'cat', joinedAt: 1, connected: true, role });
const state = (selfId: string | undefined, over: Partial<RoomSnapshot> = {}): RoomClientState => ({
  ...initialRoomState,
  selfId,
  snapshot: {
    code: 'ABCD23', name: 'R', theme: 'cloud', hasPassword: false, hostId: 'h', settings: DEFAULT_SETTINGS, createdAt: 0,
    maxParticipants: 8, participants: [part('h', 'host'), part('c', 'co_host'), part('m', 'member')],
    media: null, playback: { rev: 0, status: 'paused', positionSec: 0, updatedAt: 0 }, queue: [], suggestions: [], game: null,
    chat: [], serverTime: 0, ...over,
  },
});

describe('role selectors', () => {
  it('reads the role from the server snapshot', () => {
    expect(selectSelfRole(state('h'))).toBe('host');
    expect(selectSelfRole(state('c'))).toBe('co_host');
    expect(selectSelfRole(state('m'))).toBe('member');
    expect(selectSelfRole(state(undefined))).toBe('member');
    expect(selectSelfRole(initialRoomState)).toBe('member');
  });
  it('treats the host and co-hosts as controllers', () => {
    expect(selectIsController(state('h'))).toBe(true);
    expect(selectIsController(state('c'))).toBe(true);
    expect(selectIsController(state('m'))).toBe(false);
  });
  it('selectCan follows the permission matrix and settings', () => {
    expect(selectCan('playback.control')(state('c'))).toBe(true);
    expect(selectCan('playback.control')(state('m'))).toBe(false);
    expect(selectCan('room.roles')(state('c'))).toBe(false);
    expect(selectCan('room.roles')(state('h'))).toBe(true);
    expect(selectCan('member.kick')(state('c'))).toBe(true);
    expect(selectCan('member.kick')(state('c', { settings: { ...DEFAULT_SETTINGS, coHostsCanKick: false } }))).toBe(false);
  });
});