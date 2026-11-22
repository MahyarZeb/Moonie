import type { ErrorCode, RoomPeek, RoomSnapshot, ServerMessage } from '@shared/protocol';
import type { ConnectionStatus } from '@/lib/signaling/types';

export type Phase = 'idle' | 'peeking' | 'lobby' | 'joining' | 'in-room' | 'ended';

export interface RoomError {
  code: ErrorCode | 'network' | 'timeout';
  message: string;
}

export interface RoomClientState {
  connection: ConnectionStatus;
  attempt: number;
  /** Close code of the last connection loss, used to pick the reconnect banner text. */
  closeCode?: number;
  phase: Phase;
  /** False until the user presses "Enter room". Only meaningful when phase is 'in-room'. */
  entered: boolean;
  /** Set by begin-join: whether the next room:joined should land directly inside the room. */
  enterOnJoin: boolean;
  peek?: RoomPeek;
  /** Set when the lobby could not load the room (not found, network). */
  peekError?: RoomError;
  selfId?: string;
  snapshot?: RoomSnapshot;
  /** participantId -> expiry (ms epoch) */
  typing: Record<string, number>;
  lastError?: RoomError & { at: number };
  endedReason?: 'kicked' | 'closed' | 'left';
}

export type LocalAction =
  | { type: 'connection'; status: ConnectionStatus; attempt?: number; closeCode?: number }
  | { type: 'typing-expire'; now: number }
  | { type: 'clear-error' }
  | { type: 'local-error'; error: RoomError; at?: number }
  | { type: 'begin-peek' }
  | { type: 'begin-join'; enter: boolean }
  | { type: 'join-failed' }
  | { type: 'peek-failed'; error: RoomError }
  | { type: 'enter' }
  | { type: 'reset' };

export type RoomEvent = ServerMessage | LocalAction;

export const TYPING_TTL_MS = 5000;

export const initialRoomState: RoomClientState = {
  connection: 'idle',
  attempt: 0,
  phase: 'idle',
  entered: false,
  enterOnJoin: false,
  typing: {},
};

/** The single place where server messages are applied to client state. Pure, so it is unit-testable. */
export function roomReducer(state: RoomClientState, event: RoomEvent): RoomClientState {
  switch (event.type) {
    // ----- local actions
    case 'connection':
      return {
        ...state,
        connection: event.status,
        attempt: event.attempt ?? state.attempt,
        closeCode: event.status === 'open' ? undefined : (event.closeCode ?? state.closeCode),
      };
    case 'typing-expire': {
      const typing = Object.fromEntries(Object.entries(state.typing).filter(([, exp]) => exp > event.now));
      return Object.keys(typing).length === Object.keys(state.typing).length ? state : { ...state, typing };
    }
    case 'clear-error':
      return { ...state, lastError: undefined };
    case 'local-error':
      return { ...state, lastError: { ...event.error, at: event.at ?? Date.now() } };
    case 'begin-peek':
      return state.phase === 'idle' ? { ...state, phase: 'peeking', peekError: undefined } : state;
    case 'begin-join':
      return { ...state, phase: 'joining', enterOnJoin: event.enter };
    case 'join-failed':
      // A failed join leaves the lobby in place (or goes back to it).
      return state.phase === 'joining'
        ? { ...state, phase: state.peek || state.snapshot ? 'lobby' : 'idle', enterOnJoin: false }
        : state;
    case 'peek-failed':
      return { ...state, peekError: event.error, phase: state.phase === 'peeking' ? 'lobby' : state.phase };
    case 'enter':
      return state.phase === 'in-room' ? { ...state, entered: true } : state;
    case 'reset':
      return { ...initialRoomState, connection: state.connection, attempt: state.attempt, closeCode: state.closeCode };

    // ----- server messages
    case 'room:info': {
      const phase = state.phase === 'idle' || state.phase === 'peeking' ? 'lobby' : state.phase;
      return { ...state, peek: event.peek, peekError: undefined, phase };
    }
    case 'room:joined': {
      const resumedInPlace = event.resumed && state.snapshot !== undefined;
      return {
        ...state,
        phase: 'in-room',
        entered: resumedInPlace ? state.entered : state.enterOnJoin || event.resumed,
        enterOnJoin: false,
        selfId: event.selfId,
        snapshot: event.snapshot,
        peek: undefined,
        peekError: undefined,
        typing: {},
        endedReason: undefined,
      };
    }
    case 'room:closed':
      return {
        ...state,
        phase: 'lobby',
        entered: false,
        enterOnJoin: false,
        snapshot: undefined,
        selfId: undefined,
        typing: {},
        endedReason: 'closed',
      };
    case 'kicked':
      return {
        ...state,
        phase: 'ended',
        entered: false,
        enterOnJoin: false,
        snapshot: undefined,
        selfId: undefined,
        typing: {},
        endedReason: 'kicked',
      };
    case 'error':
      if (event.code === 'stale') return state;
      return { ...state, lastError: { code: event.code, message: event.message, at: Date.now() } };
    case 'sync:pong':
    case 'rtc:signal':
      return state;
  }

  // Everything below needs a joined room.
  const snapshot = state.snapshot;
  if (!snapshot) return state;

  switch (event.type) {
    case 'participant:joined': {
      const exists = snapshot.participants.some((p) => p.id === event.participant.id);
      const participants = exists
        ? snapshot.participants.map((p) => (p.id === event.participant.id ? event.participant : p))
        : [...snapshot.participants, event.participant];
      return { ...state, snapshot: { ...snapshot, participants } };
    }
    case 'participant:updated':
      return {
        ...state,
        snapshot: {
          ...snapshot,
          participants: snapshot.participants.map((p) => (p.id === event.participant.id ? event.participant : p)),
        },
      };
    case 'participant:left': {
      const typing = { ...state.typing };
      delete typing[event.id];
      return {
        ...state,
        typing,
        snapshot: { ...snapshot, participants: snapshot.participants.filter((p) => p.id !== event.id) },
      };
    }
    case 'host:changed':
      return { ...state, snapshot: { ...snapshot, hostId: event.hostId } };
    case 'room:settings':
      return {
        ...state,
        snapshot: { ...snapshot, name: event.name, theme: event.theme, hasPassword: event.hasPassword, settings: event.settings },
      };
    case 'media:state':
      return { ...state, snapshot: { ...snapshot, media: event.media, playback: event.playback, queue: event.queue } };
    case 'playback:state':
      return { ...state, snapshot: { ...snapshot, playback: event.playback } };
    case 'queue:updated':
      return { ...state, snapshot: { ...snapshot, queue: event.queue } };
    case 'suggestions:updated':
      return { ...state, snapshot: { ...snapshot, suggestions: event.suggestions } };
    case 'chat:deleted':
      return { ...state, snapshot: { ...snapshot, chat: snapshot.chat.filter((m) => m.id !== event.id) } };
    case 'chat:message': {
      const chat = [...snapshot.chat, event.message].slice(-100);
      const typing = { ...state.typing };
      if (event.message.from) delete typing[event.message.from];
      return { ...state, typing, snapshot: { ...snapshot, chat } };
    }
    case 'chat:typing': {
      const typing = { ...state.typing };
      if (event.typing) typing[event.id] = Date.now() + TYPING_TTL_MS;
      else delete typing[event.id];
      return { ...state, typing };
    }
    case 'game:state':
      return { ...state, snapshot: { ...snapshot, game: event.game } };
    default:
      return state;
  }
}
