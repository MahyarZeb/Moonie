import type { ClientMessage } from '../../../shared/protocol';
import { Conn, type HandlerContext } from '../connection';
import { hashPassword, type PasswordHash } from '../password';
import type { Room } from '../room';

type Msg<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;

export function handleLeave(_ctx: HandlerContext, conn: Conn): void {
  const { room, pid } = conn;
  if (!room || !pid) return;
  conn.room = null;
  conn.pid = null;
  room.removeParticipant(pid, 'left');
}

export function handleProfile(_ctx: HandlerContext, room: Room, pid: string, msg: Msg<'profile:update'>): void {
  room.updateProfile(pid, { displayName: msg.displayName, avatar: msg.avatar });
}

export async function handleSettings(
  ctx: HandlerContext,
  conn: Conn,
  room: Room,
  pid: string,
  msg: Msg<'room:settings'>,
): Promise<void> {
  if (room.hostId !== pid) return conn.error('not_host', 'Only the host can change settings', msg.ref);
  let password: PasswordHash | null | undefined;
  if (msg.password === null) password = null;
  else if (typeof msg.password === 'string') {
    try {
      password = await hashPassword(msg.password);
    } catch (err) {
      ctx.log.error('password hash failed', { error: String(err) });
      return conn.error('server_busy', 'Could not save the password, try again', msg.ref);
    }
  }
  const res = room.applySettings(pid, { name: msg.name, theme: msg.theme }, password);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}

export function handleTransfer(conn: Conn, room: Room, pid: string, msg: Msg<'host:transfer'>): void {
  const res = room.transferHost(pid, msg.to);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}

export function handleKick(conn: Conn, room: Room, pid: string, msg: Msg<'host:kick'>): void {
  const res = room.kick(pid, msg.id);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}

export function handlePing(ctx: HandlerContext, conn: Conn, msg: Msg<'sync:ping'>): void {
  conn.send({ type: 'sync:pong', t0: msg.t0, serverTime: ctx.clock.now() });
}
