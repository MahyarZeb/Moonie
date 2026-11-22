'use client';

import { ListVideo, Users } from 'lucide-react';
import { QueuePanel } from '@/components/media/QueuePanel';
import { Tabs } from '@/components/ui/Tabs';
import { useRoom } from '@/lib/room/RoomProvider';
import { ParticipantList } from './ParticipantList';

export type SidebarPanel = 'people' | 'queue';

/**
 * Right-hand panel on desktop. Only panels whose features exist are listed.
 * Chat and Games join it in their own phases. On phones the bottom tab bar picks the panel.
 */
export function Sidebar({
  className,
  panel,
  onPanelChange,
}: {
  className?: string;
  panel: SidebarPanel;
  onPanelChange: (panel: SidebarPanel) => void;
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
          {panel === 'people' ? <Users size={18} aria-hidden /> : <ListVideo size={18} aria-hidden />}
          {panel === 'people' ? 'People' : 'Queue'}
        </h2>
        {panel === 'people' ? <ParticipantList /> : <QueuePanel />}
      </div>
    </aside>
  );
}
