'use client';

import { useState, useSyncExternalStore } from 'react';
import { MediaStage } from '@/components/media/MediaStage';
import { useRoom } from '@/lib/room/RoomProvider';
import { countUnread } from '@/lib/room/unread';
import { cn } from '@/lib/utils/cn';
import { MobileTabBar, type MobileTab } from './MobileTabBar';
import { ReconnectBanner } from './ReconnectBanner';
import { RoomHeader } from './RoomHeader';
import { RoomThemeBackdrop } from './RoomThemeBackdrop';
import { Sidebar } from './Sidebar';

const DESKTOP_QUERY = '(min-width: 1024px)';
function subscribeDesktop(cb: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

/** The in-room layout: stage on the left, panels on the right. On phones one section shows at a time. */
export function RoomView() {
  const theme = useRoom((s) => s.snapshot?.theme);
  const [tab, setTab] = useState<MobileTab>('watch');
  const isDesktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP_QUERY).matches, () => false);
  const chat = useRoom((s) => s.snapshot?.chat);
  const selfId = useRoom((s) => s.selfId);
  const chatVisible = tab === 'chat' || (tab === 'watch' && isDesktop);
  const lastChatId = chat?.at(-1)?.id;
  const [seenId, setSeenId] = useState(lastChatId);
  if (chatVisible && seenId !== lastChatId) setSeenId(lastChatId);
  const unread = chatVisible || !chat ? 0 : countUnread(chat, seenId, selfId);

  return (
    <div data-room-theme={theme} className="relative flex min-h-dvh flex-col">
      <RoomThemeBackdrop theme={theme} />
      <RoomHeader />
      <ReconnectBanner />
      <main className="relative z-10 mx-auto grid w-full max-w-[1500px] flex-1 gap-4 px-3 pb-24 pt-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:pb-6">
        <div className={cn('min-w-0 space-y-4', tab !== 'watch' && 'hidden lg:block')}>
          <MediaStage />
        </div>
        <Sidebar
          className={cn('min-h-[300px] lg:block', tab === 'watch' && 'hidden')}
          panel={tab === 'watch' ? 'chat' : tab}
          unread={unread}
          onPanelChange={setTab}
        />
      </main>
      <MobileTabBar value={tab} onChange={setTab} unread={unread} />
    </div>
  );
}
