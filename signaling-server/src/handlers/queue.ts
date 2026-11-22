import type { ClientMessage } from '../../../shared/protocol';
import type { Conn } from '../connection';
import type { Room } from '../room';

type Msg<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;

export function handleQueueAdd(conn: Conn, room: Room, pid: string, msg: Msg<'queue:add'>): void {
  const res = room.queueAdd(pid, msg.videoId, msg.title, msg.ref);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}

export function handleQueueRemove(conn: Conn, room: Room, pid: string, msg: Msg<'queue:remove'>): void {
  const res = room.queueRemove(pid, msg.itemId, msg.ref);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}

export function handleQueueReorder(conn: Conn, room: Room, pid: string, msg: Msg<'queue:reorder'>): void {
  const res = room.queueReorder(pid, msg.itemId, msg.toIndex, msg.ref);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}

export function handleQueuePlay(conn: Conn, room: Room, pid: string, msg: Msg<'queue:play'>): void {
  const res = room.queuePlay(pid, msg.itemId, msg.ref);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}
