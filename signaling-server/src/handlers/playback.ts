import type { ClientMessage } from '../../../shared/protocol';
import type { Conn } from '../connection';
import type { Room } from '../room';

export function handlePlayback(
  conn: Conn,
  room: Room,
  pid: string,
  msg: Extract<ClientMessage, { type: 'playback:command' }>,
): void {
  const res = room.playbackCommand(pid, msg, msg.ref);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}
