import type { ClientMessage } from '../../../shared/protocol';
import type { Conn } from '../connection';
import type { Room } from '../room';

type Msg<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;

export function handleMediaSet(conn: Conn, room: Room, pid: string, msg: Msg<'media:set'>): void {
  const res = room.setMedia(pid, msg.media, msg.ref);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}

export function handleMediaEnded(conn: Conn, room: Room, pid: string, msg: Msg<'media:ended'>): void {
  const res = room.mediaFinished(pid, msg.rev, false);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}

export function handleMediaError(conn: Conn, room: Room, pid: string, msg: Msg<'media:error'>): void {
  const res = room.mediaFinished(pid, msg.rev, true);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}
