'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { useRoom, useRoomController } from '@/lib/room/RoomProvider';
import { ErrorBoundary } from './ErrorBoundary';
import { ErrorState } from './ErrorState';
import { Lobby } from './Lobby';
import { RoomView } from './RoomView';
import { ReconnectBanner } from './ReconnectBanner';

/**
 * Client entry for /room/CODE. Decides between lobby, room and the kicked screen.
 * The effect is Strict Mode safe: `beginAttempt` makes the second run a no-op, and the leave on cleanup is deferred
 * so the simulated unmount does not send `room:leave`.
 */
export function RoomShell({ code }: { code: string }) {
  const controller = useRoomController();

  useEffect(() => {
    controller.cancelPendingLeave();
    if (controller.beginAttempt(code)) void controller.open(code);
    return () => controller.scheduleLeave();
  }, [controller, code]);

  const phase = useRoom((s) => s.phase);
  const entered = useRoom((s) => s.entered);
  const hasSnapshot = useRoom((s) => s.snapshot !== undefined);
  const endedReason = useRoom((s) => s.endedReason);

  let body;
  if (phase === 'ended') {
    body = (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4">
        <Logo />
        <ErrorState
          emoji={endedReason === 'kicked' ? '🚪' : '🌙'}
          title={endedReason === 'kicked' ? 'You were removed from the room' : 'This room has ended'}
          text={endedReason === 'kicked' ? 'The host removed you. You can ask for the invite again if it was a mistake.' : 'Thanks for hanging out.'}
        >
          <Link
            href="/"
            className="rounded-full bg-gradient-to-r from-pink to-lavender px-6 py-3 text-center font-display font-bold text-[rgb(61_44_92)] shadow-soft"
          >
            Back home
          </Link>
        </ErrorState>
      </div>
    );
  } else if (phase === 'in-room' && entered && hasSnapshot) {
    body = <RoomView />;
  } else {
    body = (
      <>
        <Lobby code={code} />
        <div className="fixed inset-x-0 top-0 z-40">
          <ReconnectBanner />
        </div>
      </>
    );
  }

  return <ErrorBoundary>{body}</ErrorBoundary>;
}
