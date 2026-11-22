'use client';

import { ListVideo, MessageCircle, Users } from 'lucide-react';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { QueuePanel } from '@/components/media/QueuePanel';
import { Tabs } from '@/components/ui/Tabs';
import { useRoom } from '@/lib/room/RoomProvider';
import { ParticipantList } from './ParticipantList';

export type SidebarPanel = 'chat' | 'people' | 'queue';

/**
 * Right-hand panel on desktop. Only panels whose features exist are listed.
 * Games joins it in its own phase. On phones the bottom tab bar picks the panel.
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
          ]}
        />
        <h2 className="flex items-center gap-2 text-lg lg:hidden">
          {panel === 'chat' ? <MessageCircle size={18} aria-hidden /> : panel === 'people' ? <Users size={18} aria-hidden /> : <ListVideo size={18} aria-hidden />}
          {panel === 'chat' ? 'Chat' : panel === 'people' ? 'People' : 'Queue'}
        </h2>
        {panel === 'chat' ? <ChatPanel /> : panel === 'people' ? <ParticipantList /> : <QueuePanel />}
      </div>
    </aside>
  );
}
