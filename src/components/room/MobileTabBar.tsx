'use client';

import type { ReactNode } from 'react';
import { Gamepad2, ListVideo, MessageCircle, Tv, Users } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type MobileTab = 'watch' | 'chat' | 'people' | 'queue' | 'games';

const TABS: { id: MobileTab; label: string; icon: ReactNode }[] = [
  { id: 'watch', label: 'Watch', icon: <Tv size={20} /> },
  { id: 'chat', label: 'Chat', icon: <MessageCircle size={20} /> },
  { id: 'people', label: 'People', icon: <Users size={20} /> },
  { id: 'queue', label: 'Queue', icon: <ListVideo size={20} /> },
  { id: 'games', label: 'Games', icon: <Gamepad2 size={20} /> },
];

/** Bottom tab bar for phones. Panels are shown one at a time. Hidden from the lg breakpoint up. */
export function MobileTabBar({ value, onChange, unread = 0 }: { value: MobileTab; onChange: (tab: MobileTab) => void; unread?: number }) {
  return (
    <nav
      aria-label="Room sections"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-white/50 bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-white/10"
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-current={value === t.id ? 'page' : undefined}
          onClick={() => onChange(t.id)}
          className={cn(
            'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-bold transition',
            value === t.id ? 'text-purple' : 'text-ink-soft',
          )}
        >
          <span className="relative">
            {t.icon}
            {t.id === 'chat' && unread > 0 && (
              <span aria-label={` unread`} className="absolute -right-3 -top-1.5 min-w-4 rounded-full bg-pink px-1 text-center text-[10px] leading-4 text-ink">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
