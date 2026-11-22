import type { ClientMessage } from '../../../shared/protocol';
import type { Conn, HandlerContext } from '../connection';
import type { Room } from '../room';

type Msg<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;

export function handleShareStart(conn: Conn, room: Room, pid: string, msg: Msg<'share:start'>): void {
  const res = room.startShare(pid, msg, msg.ref);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}

export function handleShareStop(conn: Conn, room: Room, pid: string, msg: Msg<'share:stop'>): void {
  const res = room.stopShare(pid);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}

/** Targeted relay. Invalid targets are dropped without a reply so signals cannot be used to probe the room. */
export function handleRtcSignal(ctx: HandlerContext, room: Room, pid: string, msg: Msg<'rtc:signal'>): void {
  if (!room.relaySignal(pid, msg)) ctx.log.debug('dropped signal', { room: room.code });
}
