'use client';
import { useMemo } from 'react';
import { canActOn } from '@shared/permissions';
import type { ChatMessage } from '@shared/protocol';
import { useRoom, useRoomController } from '@/lib/room/RoomProvider';
import { selectConnectedCount, selectIsController, selectSelfRole } from '@/lib/room/selectors';
import { ChatInput } from './ChatInput';
import { MessageList } from './MessageList';
import { TypingIndicator } from './TypingIndicator';

/** Live chat: history, typing line, and the input. Messages come back from the server for everyone, sender included. */
export function ChatPanel() {
  const controller = useRoomController();
  const chat = useRoom((s) => s.snapshot?.chat);
  const participants = useRoom((s) => s.snapshot?.participants);
  const typing = useRoom((s) => s.typing);
  const selfId = useRoom((s) => s.selfId);
  const online = useRoom(selectConnectedCount);
  const selfRole = useRoom(selectSelfRole);
  const isController = useRoom(selectIsController);
  const settings = useRoom((s) => s.snapshot?.settings);
  const muted = !!participants?.find((p) => p.id === selfId)?.muted;

  // Mirrors the server rule. The server decides; this only hides buttons that would be refused.
  const canDelete = (m: ChatMessage) => {
    if (!isController || m.kind === 'system' || !m.from || m.from === selfId || !settings) return false;
    const senderRole = participants?.find((p) => p.id === m.from)?.role ?? 'member';
    return selfRole === 'host' || canActOn(selfRole, senderRole, 'chat.moderate', settings);
  };

  const typingNames = useMemo(
    () =>
      Object.keys(typing)
        .filter((id) => id !== selfId)
        .map((id) => participants?.find((p) => p.id === id)?.name)
        .filter((n): n is string => !!n),
    [typing, participants, selfId],
  );

  return (
    <div className="flex h-[60dvh] min-h-[320px] flex-col gap-2 lg:h-[calc(100dvh-13rem)]">
      <p className="text-sm font-bold text-ink-soft" aria-live="polite">
        {online} online
      </p>
      <MessageList
        messages={chat ?? []}
        selfId={selfId}
        canDelete={canDelete}
        onDelete={(m) => controller.transport.send({ type: 'chat:delete', messageId: m.id })}
      />
      <TypingIndicator names={typingNames} />
      <ChatInput
        muted={muted}
        onSend={(text) => controller.transport.send({ type: 'chat:send', text })}
        onTyping={(typing) => controller.transport.send({ type: 'chat:typing', typing })}
      />
    </div>
  );
}
