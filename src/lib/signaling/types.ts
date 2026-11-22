import type {
  ClientMessage,
  CreateRoomInput,
  ErrorCode,
  JoinedPayload,
  JoinRoomInput,
  RoomPeek,
  RtcSignalData,
  ServerMessage,
} from '@shared/protocol';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'failed';
export type Unsubscribe = () => void;

export interface StatusInfo {
  attempt: number;
  nextRetryMs?: number;
  /** Close code that ended the connection, when known. */
  closeCode?: number;
}

export class TransportError extends Error {
  constructor(
    public code: ErrorCode | 'timeout' | 'network',
    message: string,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

/**
 * The replaceable seam between the UI and the realtime backend.
 * `WebSocketTransport` talks to the bundled signaling server. A different backend
 * (Ably, PartyKit, Liveblocks) only has to implement this interface.
 */
export interface SignalingTransport {
  readonly status: ConnectionStatus;
  /** Resolves when open. Rejects if the first attempt fails. */
  connect(): Promise<void>;
  /** Intentional close, no auto-reconnect. */
  disconnect(): void;
  /** Manual retry from `failed` or `closed`. Resumes a joined room, never creates a fresh join. */
  reconnect(): void;

  peekRoom(code: string): Promise<RoomPeek>;
  createRoom(input: CreateRoomInput): Promise<JoinedPayload>;
  joinRoom(input: JoinRoomInput): Promise<JoinedPayload>;
  leaveRoom(): void;

  /** Fire-and-forget. Dropped, with a local error notice, while not open. */
  send(msg: ClientMessage): void;
  /** Sends a message with a ref and resolves with the first non-error reply carrying it. */
  request(msg: ClientMessage): Promise<ServerMessage>;
  sendSignal(to: string, sessionId: string, linkId: string, data: RtcSignalData): void;

  onMessage(handler: (msg: ServerMessage) => void): Unsubscribe;
  onStatus(handler: (status: ConnectionStatus, info?: StatusInfo) => void): Unsubscribe;
  /** Errors raised on the client itself (for example a dropped send). */
  onLocalError(handler: (message: string) => void): Unsubscribe;

  /** Smoothed offset: serverNow() = Date.now() + clockOffsetMs. */
  getClockOffsetMs(): number;
}
