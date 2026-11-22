'use client';

import { useState } from 'react';
import { MediaStage } from '@/components/media/MediaStage';
import { useRoom } from '@/lib/room/RoomProvider';
import { cn } from '@/lib/utils/cn';
import { MobileTabBar, type MobileTab } from './MobileTabBar';
import { ReconnectBanner } from './ReconnectBanner';
import { RoomHeader } from './RoomHeader';
import { RoomThemeBackdrop } from './RoomThemeBackdrop';
import { Sidebar } from './Sidebar';

/** The in-room layout: stage on the left, panels on the right. On phones one section shows at a time. */
export function RoomView() {
  const theme = useRoom((s) => s.snapshot?.theme);
  const [tab, setTab] = useState<MobileTab>('watch');

  return (
    <div data-room-theme={theme} className="relative flex min-h-dvh flex-col">
      <RoomThemeBackdrop theme={theme} />
      <RoomHeader />
      <ReconnectBanner />
      <main className="relative z-10 mx-auto grid w-full max-w-[1500px] flex-1 gap-4 px-3 pb-24 pt-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:pb-6">
        <div className={cn('min-w-0 space-y-4', tab !== 'watch' && 'hidden lg:block')}>
          <MediaStage />
        </div>
        <Sidebar className={cn('min-h-[300px] lg:block', tab !== 'people' && 'hidden')} />
      </main>
      <MobileTabBar value={tab} onChange={setTab} />
    </div>
  );
}
