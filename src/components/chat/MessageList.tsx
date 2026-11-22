'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { ChatMessage } from '@shared/protocol';
import { MessageBubble } from './MessageBubble';

const STICK_PX = 80;

/** Scrolls to the newest message while the reader is near the bottom, otherwise shows a "New messages" pill. */
export function MessageList({ messages, selfId }: { messages: ChatMessage[]; selfId?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const lastId = useRef<string | undefined>(undefined);
  const [pill, setPill] = useState(false);

  const toBottom = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    stuck.current = true;
    setPill(false);
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
    if (stuck.current) setPill(false);
  };

  const newest = messages.at(-1);
  useLayoutEffect(() => {
    if (!newest || newest.id === lastId.current) return;
    const first = lastId.current === undefined;
    lastId.current = newest.id;
    if (first || stuck.current || newest.from === selfId) toBottom();
    else setPill(true);
  }, [newest, selfId, toBottom]);

  useEffect(() => {
    // The panel can be hidden (display: none) while messages arrive, so re-stick when it becomes visible.
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stuck.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto pr-1 scrollbar-soft" role="log" aria-label="Chat messages">
        {messages.length === 0 ? (
          <p className="rounded-2xl bg-surface-2 px-4 py-6 text-center text-sm text-ink-soft">No messages yet. Say hi! 👋</p>
        ) : (
          <ul className="space-y-2.5 py-1">
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const showHeader = m.kind === 'system' || !prev || prev.kind === 'system' || prev.from !== m.from;
              return <MessageBubble key={m.id} message={m} own={!!selfId && m.from === selfId} showHeader={showHeader} />;
            })}
          </ul>
        )}
      </div>
      {pill && (
        <button
          type="button"
          onClick={toBottom}
          className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-purple px-3 py-1.5 text-xs font-bold text-white shadow-soft transition hover:-translate-y-0.5"
        >
          <ArrowDown size={13} aria-hidden /> New messages
        </button>
      )}
    </div>
  );
}
