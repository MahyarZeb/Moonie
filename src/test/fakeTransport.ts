import type { ClientMessage, CreateRoomInput, JoinedPayload, JoinRoomInput, RoomPeek, RoomSnapshot, ServerMessage } from '@shared/protocol';
import {
  TransportError,
  type ConnectionStatus,
  type SignalingTransport,
} from '@/lib/signaling/types';

export const PEEK: RoomPeek = {
  code: 'ABCD23',
  name: 'Test room',
  theme: 'cloud',
  hasPassword: false,
  count: 1,
  max: 8,
  hostName: 'Host',
  participants: [{ name: 'Host', avatar: 'cat' }],
};

export function makeSnapshot(code = 'ABCD23'): RoomSnapshot {
  return {
    code,
    name: 'Test room',
    theme: 'cloud',
    hasPassword: false,
    hostId: 'me',
    createdAt: 0,
    maxParticipants: 8,
    participants: [{ id: 'me', name: 'Mochi', avatar: 'cat', joinedAt: 1, connected: true }],
    media: null,
    playback: { rev: 0, status: 'paused', positionSec: 0, updatedAt: 0 },
    queue: [],
    game: null,
    chat: [],
    serverTime: 0,
  };
}

/** In-memory transport for UI and controller tests. Replies arrive asynchronously, like the network. */
export class FakeTransport implements SignalingTransport {
  status: ConnectionStatus = 'open';
  peeks: string[] = [];
  joins: JoinRoomInput[] = [];
  creates: CreateRoomInput[] = [];
  leaves = 0;
  sent: ClientMessage[] = [];
  joinError: TransportError | null = null;
  peekError: TransportError | null = null;
  private handlers = new Set<(m: ServerMessage) => void>();

  emit(msg: ServerMessage) {
    for (const h of [...this.handlers]) h(msg);
  }

  async connect() {}
  disconnect() {}
  reconnect() {}

  async peekRoom(code: string) {
    this.peeks.push(code);
    await Promise.resolve();
    if (this.peekError) throw this.peekError;
    const peek = { ...PEEK, code };
    this.emit({ type: 'room:info', peek });
    return peek;
  }

  async createRoom(input: CreateRoomInput): Promise<JoinedPayload> {
    this.creates.push(input);
    await Promise.resolve();
    return this.deliverJoin('ABCD23', 'tok-create', false);
  }

  async joinRoom(input: JoinRoomInput): Promise<JoinedPayload> {
    this.joins.push(input);
    await Promise.resolve();
    if (this.joinError) throw this.joinError;
    return this.deliverJoin(input.code, 'tok-join', input.resumeToken !== undefined);
  }

  private deliverJoin(code: string, resumeToken: string, resumed: boolean): JoinedPayload {
    const payload: JoinedPayload = { selfId: 'me', resumeToken, snapshot: makeSnapshot(code), resumed };
    this.emit({ type: 'room:joined', ...payload });
    return payload;
  }

  leaveRoom() {
    this.leaves++;
  }

  send(msg: ClientMessage) {
    this.sent.push(msg);
  }

  async request(): Promise<ServerMessage> {
    throw new TransportError('network', 'not implemented in the fake');
  }

  sendSignal() {}

  onMessage(handler: (m: ServerMessage) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onStatus() {
    return () => {};
  }

  onLocalError() {
    return () => {};
  }

  getClockOffsetMs() {
    return 0;
  }
}
