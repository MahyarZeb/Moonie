import type { ChatMessage } from '@shared/protocol';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/utils/cn';
import { formatClock } from '@/lib/utils/format';

/** One chat line. Text is rendered as a React child, never as HTML. */
export function MessageBubble({ message, own, showHeader }: { message: ChatMessage; own: boolean; showHeader: boolean }) {
  if (message.kind === 'system') {
    return (
      <li className="my-1 text-center text-xs font-semibold text-ink-soft">
        <span className="rounded-full bg-surface-2 px-3 py-1">{message.text}</span>
      </li>
    );
  }
  return (
    <li className={cn('flex items-end gap-2', own ? 'flex-row-reverse' : 'flex-row', !showHeader && 'mt-[-0.25rem]')}>
      {message.avatar && showHeader ? <Avatar avatar={message.avatar} size="sm" /> : <span className="w-7 shrink-0" />}
      <div className={cn('flex min-w-0 max-w-[80%] flex-col', own ? 'items-end' : 'items-start')}>
        {showHeader && (
          <span className="mb-0.5 px-1 text-xs font-bold text-ink-soft">
            {own ? 'You' : (message.name ?? 'Someone')} · <time dateTime={new Date(message.ts).toISOString()}>{formatClock(message.ts)}</time>
          </span>
        )}
        <p
          className={cn(
            'whitespace-pre-wrap break-words rounded-3xl px-3.5 py-2 text-sm shadow-sm [overflow-wrap:anywhere]',
            own ? 'rounded-br-lg bg-purple/80 text-white' : 'rounded-bl-lg bg-surface-2 text-ink',
          )}
        >
          {message.text}
        </p>
      </div>
    </li>
  );
}
