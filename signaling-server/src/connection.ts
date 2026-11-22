import type { ErrorCode, ServerMessage } from '../../shared/protocol';
import type { Config } from './config';
import type { Logger } from './log';
import { AbuseCounter, ConnectionLimiter } from './rateLimit';
import type { RoomRegistry } from './registry';
import type { Clock, Room, SocketLike } from './room';

/** One WebSocket connection. A connection holds at most one room membership. */
export class Conn {
  room: Room | null = null;
  pid: string | null = null;
  closed = false;
  lastMessageAt: number;
  lastPongAt: number;
  readonly connectedAt: number;
  readonly limiter: ConnectionLimiter;
  readonly abuse = new AbuseCounter();
  /** Handlers run one at a time so async password hashing cannot reorder messages. */
  chain: Promise<void> = Promise.resolve();

  constructor(
    readonly id: number,
    readonly ip: string,
    readonly socket: SocketLike,
    now: number,
  ) {
    this.connectedAt = now;
    this.lastMessageAt = now;
    this.lastPongAt = now;
    this.limiter = new ConnectionLimiter(now);
  }

  send(msg: ServerMessage): void {
    if (this.closed) return;
    try {
      this.socket.send(JSON.stringify(msg));
    } catch {
      /* socket is going away */
    }
  }

  error(code: ErrorCode, message: string, ref?: string): void {
    this.send(ref ? { type: 'error', code, message, ref } : { type: 'error', code, message });
  }
}

/** Idle rule for sockets that are not in a room: no message for `idleMs`, or open longer than `unjoinedMaxMs`. */
export function idleReason(
  conn: Pick<Conn, 'room' | 'lastMessageAt' | 'connectedAt'>,
  now: number,
  config: Pick<Config, 'idleMs' | 'unjoinedMaxMs'>,
): 'idle' | 'too_old' | null {
  if (conn.room) return null;
  if (now - conn.connectedAt >= config.unjoinedMaxMs) return 'too_old';
  if (now - conn.lastMessageAt >= config.idleMs) return 'idle';
  return null;
}

export interface HandlerContext {
  registry: RoomRegistry;
  config: Config;
  clock: Clock;
  log: Logger;
}
