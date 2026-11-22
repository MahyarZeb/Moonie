'use client';

import { Users } from 'lucide-react';
import { ParticipantList } from './ParticipantList';

/**
 * Right-hand panel on desktop. Only panels whose features exist are listed, so for now it holds People.
 * Chat, Queue and Games join it in their own phases.
 */
export function Sidebar({ className }: { className?: string }) {
  return (
    <aside aria-label="Room panels" className={className}>
      <div className="card-soft h-full p-4">
        <h2 className="mb-3 flex items-center gap-2 text-lg">
          <Users size={18} aria-hidden /> People
        </h2>
        <ParticipantList />
      </div>
    </aside>
  );
}
