'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Crown, LogOut } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useRoom, useRoomController } from '@/lib/room/RoomProvider';
import { selectIsHost } from '@/lib/room/selectors';
import { getRoomTheme } from '@/lib/theme/roomThemes';
import { InviteButton } from './InviteButton';
import { SettingsButton, SettingsDialog } from './SettingsDialog';

export function RoomHeader() {
  const router = useRouter();
  const controller = useRoomController();
  const snapshot = useRoom((s) => s.snapshot);
  const isHost = useRoom(selectIsHost);
  const [settingsOpen, setSettingsOpen] = useState(false);
  if (!snapshot) return null;

  function leave() {
    controller.leave();
    router.push('/');
  }

  return (
    <header className="relative z-20 border-b border-white/50 bg-bg/70 backdrop-blur-md dark:border-white/10">
      <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-3 py-2.5 sm:px-5">
        <Logo className="hidden sm:inline-flex" />
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 truncate text-lg sm:text-xl">
            <span aria-hidden>{getRoomTheme(snapshot.theme).emoji}</span>
            <span className="truncate">{snapshot.name}</span>
          </h1>
          <div className="flex items-center gap-2 text-xs text-ink-soft">
            <Badge tone="lavender">{snapshot.code}</Badge>
            {isHost && (
              <Badge tone="pink">
                <Crown size={11} aria-hidden /> You are the host
              </Badge>
            )}
          </div>
        </div>
        <InviteButton code={snapshot.code} />
        <SettingsButton onClick={() => setSettingsOpen(true)} />
        <ThemeToggle />
        <Button size="sm" variant="ghost" icon={<LogOut size={16} />} onClick={leave} aria-label="Leave room">
          <span className="hidden md:inline">Leave</span>
        </Button>
      </div>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
