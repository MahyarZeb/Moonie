import { initialRoomState, roomReducer, type RoomClientState, type RoomEvent } from './reducer';

export interface RoomStore {
  getState(): RoomClientState;
  subscribe(listener: () => void): () => void;
  dispatch(event: RoomEvent): void;
}

/**
 * A minimal external store. It is not React state, so sync controllers (YouTube, WebRTC, local video)
 * read it imperatively and are not driven by re-renders.
 */
export function createRoomStore(initial: RoomClientState = initialRoomState): RoomStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(event) {
      const next = roomReducer(state, event);
      if (next === state) return;
      state = next;
      for (const l of [...listeners]) l();
    },
  };
}
