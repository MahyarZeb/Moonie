import { DEFAULT_SETTINGS, can, isController, type Action } from '@shared/permissions';
import type { Participant, Role } from '@shared/protocol';
import type { RoomClientState } from './reducer';

export const selectSnapshot = (s: RoomClientState) => s.snapshot;
export const selectSelf = (s: RoomClientState): Participant | undefined =>
  s.snapshot?.participants.find((p) => p.id === s.selfId);
export const selectIsHost = (s: RoomClientState): boolean => !!s.selfId && s.snapshot?.hostId === s.selfId;
export const selectHost = (s: RoomClientState): Participant | undefined =>
  s.snapshot?.participants.find((p) => p.id === s.snapshot?.hostId);
export const selectConnectedCount = (s: RoomClientState): number =>
  s.snapshot?.participants.filter((p) => p.connected).length ?? 0;
/** True when the room page should show the in-room UI. */
export const selectInRoom = (s: RoomClientState): boolean => s.phase === 'in-room' && s.entered && !!s.snapshot;

/** The caller's role as the server reports it. Members until the snapshot says otherwise. */
export const selectSelfRole = (s: RoomClientState): Role => {
  if (!s.selfId || !s.snapshot) return 'member';
  if (s.snapshot.hostId === s.selfId) return 'host';
  return selectSelf(s)?.role ?? 'member';
};

/** Host or co-host. Used to show controls; the server enforces the real rule. */
export const selectIsController = (s: RoomClientState): boolean => isController(selectSelfRole(s));

/** Builds a selector for `can(role, action, settings)`. Create it once outside render (or memoize it). */
export const selectCan =
  (action: Action) =>
  (s: RoomClientState): boolean =>
    can(selectSelfRole(s), action, s.snapshot?.settings ?? DEFAULT_SETTINGS);