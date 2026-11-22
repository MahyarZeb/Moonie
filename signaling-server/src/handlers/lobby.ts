import { CLOSE_REPLACED } from '../../../shared/constants';
import type { ClientMessage } from '../../../shared/protocol';
import { Conn, type HandlerContext } from '../connection';
import { hashPassword, verifyPassword } from '../password';

type Msg<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;

export function handlePeek(ctx: HandlerContext, conn: Conn, msg: Msg<'room:peek'>): void {
  const room = ctx.registry.get(msg.code);
  if (!room) return conn.error('not_found', 'Room not found', msg.ref);
  conn.send({ type: 'room:info', peek: room.peek(), ...(msg.ref ? { ref: msg.ref } : {}) });
}

export async function handleCreate(ctx: HandlerContext, conn: Conn, msg: Msg<'room:create'>): Promise<void> {
  if (conn.room) return conn.error('invalid_state', 'You are already in a room', msg.ref);
  let hash = null;
  if (msg.password) {
    try {
      hash = await hashPassword(msg.password);
    } catch (err) {
      ctx.log.error('password hash failed', { error: String(err) });
      return conn.error('server_busy', 'Could not create the room, try again', msg.ref);
    }
  }
  if (conn.closed) return;
  const created = ctx.registry.createRoom(msg.name, msg.theme);
  if (!created.ok) return conn.error(created.code, created.message, msg.ref);
  const room = created.room;
  room.passwordHash = hash;
  const { id } = room.join({ displayName: msg.displayName, avatar: msg.avatar }, conn.socket, msg.ref);
  conn.room = room;
  conn.pid = id;
}

export async function handleJoin(ctx: HandlerContext, conn: Conn, msg: Msg<'room:join'>): Promise<void> {
  if (conn.room) return conn.error('invalid_state', 'You are already in a room', msg.ref);
  const room = ctx.registry.get(msg.code);
  if (!room) return conn.error('not_found', 'Room not found', msg.ref);

  // A resume token means resume and nothing else: never a fresh join.
  if (msg.resumeToken !== undefined) {
    const sp = room.findByToken(msg.resumeToken);
    if (!sp) return conn.error('not_found', 'Session expired', msg.ref);
    room.resume(sp, conn.socket, CLOSE_REPLACED, msg.ref);
    conn.room = room;
    conn.pid = sp.participant.id;
    return;
  }

  const guard = ctx.registry.passwordGuard;
  if (room.passwordHash) {
    const now = ctx.clock.now();
    if (guard.isLocked(conn.ip, room.code, now)) {
      return conn.error('locked_out', 'Too many wrong passwords. Try again in a moment.', msg.ref);
    }
    let ok = false;
    if (msg.password) {
      try {
        ok = await verifyPassword(msg.password, room.passwordHash);
      } catch (err) {
        ctx.log.error('password verify failed', { error: String(err) });
        return conn.error('server_busy', 'Could not check the password, try again', msg.ref);
      }
    }
    if (!ok) {
      guard.recordFailure(conn.ip, room.code, ctx.clock.now());
      ctx.log.info('wrong password', { room: room.code });
      return conn.error('wrong_password', 'That password is not right', msg.ref);
    }
    guard.clear(conn.ip, room.code);
  }

  if (conn.closed || ctx.registry.get(msg.code) !== room) return;
  if (room.isFull()) {
    ctx.log.info('room full', { room: room.code });
    return conn.error('room_full', 'This room is full right now', msg.ref);
  }
  const { id } = room.join({ displayName: msg.displayName, avatar: msg.avatar }, conn.socket, msg.ref);
  conn.room = room;
  conn.pid = id;
}
