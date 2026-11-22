'use client';
import { useMemo } from 'react';
import { useRoom, useRoomController } from '@/lib/room/RoomProvider';
import { selectConnectedCount } from '@/lib/room/selectors';
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
      <MessageList messages={chat ?? []} selfId={selfId} />
      <TypingIndicator names={typingNames} />
      <ChatInput
        onSend={(text) => controller.transport.send({ type: 'chat:send', text })}
        onTyping={(typing) => controller.transport.send({ type: 'chat:typing', typing })}
      />
    </div>
  );
}
