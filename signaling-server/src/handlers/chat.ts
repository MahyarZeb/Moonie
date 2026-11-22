import type { ClientMessage } from '../../../shared/protocol';
import type { Room } from '../room';
type Msg<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;

/** Text is already sanitized by `validateClientMessage`. Rate limiting happens in the connection layer. */
export function handleChatSend(room: Room, pid: string, msg: Msg<'chat:send'>): void {
  room.addChat(pid, msg.text);
}

export function handleChatTyping(room: Room, pid: string, msg: Msg<'chat:typing'>): void {
  room.setTyping(pid, msg.typing);
}
