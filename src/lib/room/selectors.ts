import type { Participant } from '@shared/protocol';
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
