'use client';

import { useMemo } from 'react';
import type { GameAction, GameKind } from '@shared/games/types';
import { useRoomController } from '@/lib/room/RoomProvider';

/** Thin senders for the game messages. The client never changes game state itself; the server replies with `game:state`. */
export function useGameActions() {
  const controller = useRoomController();
  return useMemo(
    () => ({
      open: (kind: GameKind) => controller.transport.send({ type: 'game:open', kind }),
      close: () => controller.transport.send({ type: 'game:close' }),
      act: (action: GameAction) => controller.transport.send({ type: 'game:action', action }),
    }),
    [controller],
  );
}
