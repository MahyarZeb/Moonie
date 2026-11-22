'use client';

import type { ReactNode } from 'react';
import { Gamepad2, ListVideo, MessageCircle, Users } from 'lucide-react';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { GamesPanel } from '@/components/games/GamesPanel';
import { QueuePanel } from '@/components/media/QueuePanel';
import { Tabs } from '@/components/ui/Tabs';
import { useRoom } from '@/lib/room/RoomProvider';
import { ParticipantList } from './ParticipantList';

export type SidebarPanel = 'chat' | 'people' | 'queue' | 'games';

const PANEL_ICON: Record<SidebarPanel, ReactNode> = {
  chat: <MessageCircle size={18} aria-hidden />,
  people: <Users size={18} aria-hidden />,
  queue: <ListVideo size={18} aria-hidden />,
  games: <Gamepad2 size={18} aria-hidden />,
};
const PANEL_TITLE: Record<SidebarPanel, string> = { chat: 'Chat', people: 'People', queue: 'Queue', games: 'Games' };

/**
 * Right-hand panel on desktop. Only panels whose features exist are listed.
 * On phones the bottom tab bar picks the panel.
 */
export function Sidebar({
  className,
  panel,
  onPanelChange,
  unread = 0,
}: {
  className?: string;
  panel: SidebarPanel;
  onPanelChange: (panel: SidebarPanel) => void;
  unread?: number;
}) {
  const queueCount = useRoom((s) => s.snapshot?.queue.length ?? 0);
  const gameOpen = useRoom((s) => !!s.snapshot?.game);

  return (
    <aside aria-label="Room panels" className={className}>
      <div className="card-soft h-full space-y-3 p-4">
        <Tabs<SidebarPanel>
          label="Room panels"
          className="hidden lg:flex"
          value={panel}
          onChange={onPanelChange}
          tabs={[
            {
              id: 'chat',
              label: 'Chat',
              icon: <MessageCircle size={15} aria-hidden />,
              badge: unread > 0 ? <span aria-label={` unread`} className="rounded-full bg-pink/60 px-1.5 text-xs">{unread > 99 ? '99+' : unread}</span> : undefined,
            },
            { id: 'people', label: 'People', icon: <Users size={15} aria-hidden /> },
            {
              id: 'queue',
              label: 'Queue',
              icon: <ListVideo size={15} aria-hidden />,
              badge: queueCount > 0 ? <span className="rounded-full bg-pink/60 px-1.5 text-xs">{queueCount}</span> : undefined,
            },
            {
              id: 'games',
              label: 'Games',
              icon: <Gamepad2 size={15} aria-hidden />,
              badge: gameOpen ? <span aria-label="game open" className="h-2 w-2 rounded-full bg-pink" /> : undefined,
            },
          ]}
        />
        <h2 className="flex items-center gap-2 text-lg lg:hidden">
          {PANEL_ICON[panel]}
          {PANEL_TITLE[panel]}
        </h2>
        {panel === 'chat' ? <ChatPanel /> : panel === 'people' ? <ParticipantList /> : panel === 'games' ? <GamesPanel /> : <QueuePanel />}
      </div>
    </aside>
  );
}
