import type { ServerMessage } from '../../shared/protocol';
import { Conn, type HandlerContext } from '../src/connection';
import { loadConfig, type Config } from '../src/config';
import { dispatch } from '../src/handlers';
import { silentLogger } from '../src/log';
import { RoomRegistry } from '../src/registry';
import type { Clock, SocketLike } from '../src/room';
import { parseClientMessage } from '../../shared/validate';

export class FakeClock implements Clock {
  constructor(public t = 1_000_000) {}
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}

export class FakeSocket implements SocketLike {
  sent: ServerMessage[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }
  of<T extends ServerMessage['type']>(type: T) {
    return this.sent.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }
  last<T extends ServerMessage['type']>(type: T) {
    return this.of(type).at(-1);
  }
  clear() {
    this.sent = [];
  }
}

export function makeEnv(overrides: Record<string, string> = {}): Config {
  return loadConfig({ ALLOWED_ORIGINS: 'http://test', TRUST_PROXY_HOPS: '0', ...overrides });
}

export function makeCtx(overrides: Record<string, string> = {}) {
  const clock = new FakeClock();
  const config = makeEnv(overrides);
  const registry = new RoomRegistry(clock, config, silentLogger);
  const ctx: HandlerContext = { registry, config, clock, log: silentLogger };
  let id = 1;
  const connect = (ip = '1.1.1.1') => {
    const socket = new FakeSocket();
    const conn = new Conn(id++, ip, socket, clock.now());
    return { conn, socket };
  };
  /** Validates then dispatches, like the real socket handler. */
  const send = async (conn: Conn, raw: unknown) => {
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      if (!parsed.silent) conn.error(parsed.code, parsed.message, parsed.ref);
      return;
    }
    await dispatch(ctx, conn, parsed.msg);
  };
  /** Simulates the socket closing. */
  const drop = (c: { conn: Conn; socket: FakeSocket }) => {
    c.conn.closed = true;
    if (c.conn.room && c.conn.pid) c.conn.room.disconnect(c.conn.pid, c.socket);
  };
  return { clock, config, registry, ctx, connect, send, drop };
}

export const profile = (name = 'Mochi', avatar = 'cat') => ({ displayName: name, avatar });
