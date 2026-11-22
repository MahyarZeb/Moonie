'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Send, Smile } from 'lucide-react';
import { LIMITS } from '@shared/constants';
import { IconButton } from '@/components/ui/IconButton';
import { EmojiPicker } from './EmojiPicker';

const TYPING_THROTTLE_MS = 2000;
const TYPING_IDLE_MS = 3000;

/** Message box with an emoji popover. Reports typing at most every 2 s and clears it after 3 s idle, on blur and on send. */
export function ChatInput({
  onSend,
  onTyping,
  muted = false,
}: {
  onSend: (text: string) => void;
  onTyping: (typing: boolean) => void;
  /** A host or co-host muted this person: the box is disabled (they can still react). */
  muted?: boolean;
}) {
  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const lastTypingSent = useRef(0);
  const typingOn = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTypingRef = useRef(onTyping);
  useEffect(() => {
    onTypingRef.current = onTyping;
  });

  const stopTyping = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    if (typingOn.current) onTypingRef.current(false);
    typingOn.current = false;
    lastTypingSent.current = 0;
  }, []);

  const noteTyping = useCallback(() => {
    const now = Date.now();
    if (!typingOn.current || now - lastTypingSent.current >= TYPING_THROTTLE_MS) {
      onTypingRef.current(true);
      typingOn.current = true;
      lastTypingSent.current = now;
    }
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  }, [stopTyping]);

  useEffect(() => stopTyping, [stopTyping]);

  const change = (value: string) => {
    setText(value);
    if (value.trim()) noteTyping();
    else stopTyping();
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    stopTyping();
    onSend(trimmed);
    setText('');
    setEmojiOpen(false);
  };

  const insertEmoji = (emoji: string) => {
    const el = input.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = (text.slice(0, start) + emoji + text.slice(end)).slice(0, LIMITS.chatMax);
    change(next);
    const caret = start + emoji.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  const closeEmoji = useCallback(() => setEmojiOpen(false), []);

  return (
    <form onSubmit={submit} className="relative flex items-center gap-2">
      {emojiOpen && <EmojiPicker onPick={insertEmoji} onClose={closeEmoji} />}
      <label className="sr-only" htmlFor="chat-input">
        Message
      </label>
      <input
        id="chat-input"
        ref={input}
        value={text}
        maxLength={LIMITS.chatMax}
        autoComplete="off"
        placeholder={muted ? 'You are muted by a host' : 'Say something sweet…'}
        disabled={muted}
        onChange={(e) => change(e.target.value)}
        onBlur={stopTyping}
        className="input-soft min-w-0 flex-1"
      />
      <IconButton label="Emoji" disabled={muted} data-emoji-toggle aria-expanded={emojiOpen} onClick={() => setEmojiOpen((o) => !o)}>
        <Smile size={18} />
      </IconButton>
      <IconButton label="Send message" type="submit" disabled={muted || !text.trim()} className="bg-purple text-white hover:bg-purple/80">
        <Send size={17} />
      </IconButton>
    </form>
  );
}
