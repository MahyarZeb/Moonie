import type { ClientMessage } from '../../../shared/protocol';
import type { Conn } from '../connection';
import type { Room } from '../room';

type Msg<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;

export function handleGameOpen(conn: Conn, room: Room, pid: string, msg: Msg<'game:open'>): void {
  const res = room.openGame(pid, msg.kind);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}

export function handleGameClose(conn: Conn, room: Room, pid: string, msg: Msg<'game:close'>): void {
  const res = room.closeGame(pid);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}

/** The action is still raw here: `Room.gameAction` checks its shape against the open game's kind. */
export function handleGameAction(conn: Conn, room: Room, pid: string, msg: Msg<'game:action'>): void {
  const res = room.gameAction(pid, msg.action);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}
