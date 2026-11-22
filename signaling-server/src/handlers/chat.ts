import type { ClientMessage } from '../../../shared/protocol';
import type { Conn } from '../connection';
import type { Room } from '../room';

type Msg<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;

/** Text is already sanitized by `validateClientMessage`. Rate limiting happens in the connection layer. */
export function handleChatSend(conn: Conn, room: Room, pid: string, msg: Msg<'chat:send'>): void {
  const res = room.sendChat(pid, msg.text);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}

export function handleChatTyping(room: Room, pid: string, msg: Msg<'chat:typing'>): void {
  room.setTyping(pid, msg.typing);
}

export function handleChatDelete(conn: Conn, room: Room, pid: string, msg: Msg<'chat:delete'>): void {
  const res = room.deleteChat(pid, msg.messageId);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}

export function handleChatMute(conn: Conn, room: Room, pid: string, msg: Msg<'chat:mute'>): void {
  const res = room.muteChat(pid, msg.id, msg.muted);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}

export function handleReaction(conn: Conn, room: Room, pid: string, msg: Msg<'reaction:send'>): void {
  const res = room.react(pid, msg.emoji);
  if (!res.ok) conn.error(res.code, res.message, msg.ref);
}
