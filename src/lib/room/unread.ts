import type { ChatMessage } from '@shared/protocol';

/** Messages from other people that arrived after `seenId`. System lines do not count. */
export function countUnread(chat: ChatMessage[], seenId: string | undefined, selfId: string | undefined): number {
  const seenIndex = seenId ? chat.findIndex((m) => m.id === seenId) : -1;
  return chat.slice(seenIndex + 1).filter((m) => m.kind === 'user' && m.from !== selfId).length;
}
