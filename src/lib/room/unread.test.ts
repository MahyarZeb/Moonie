import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@shared/protocol';
import { countUnread } from './unread';

const msg = (id: string, from?: string, kind: ChatMessage['kind'] = 'user'): ChatMessage => ({ id, kind, from, text: id, ts: 0 });

describe('countUnread', () => {
  const chat = [msg('1', 'b'), msg('2', 'a'), msg('3', undefined, 'system'), msg('4', 'b'), msg('5', 'c')];
  it('counts only other people\'s messages after the last seen one', () => {
    expect(countUnread(chat, '2', 'a')).toBe(2);
    expect(countUnread(chat, '5', 'a')).toBe(0);
  });
  it('counts everything from others when the seen message rolled out of history', () => {
    expect(countUnread(chat, 'gone', 'a')).toBe(3);
    expect(countUnread(chat, undefined, 'a')).toBe(3);
  });
});
