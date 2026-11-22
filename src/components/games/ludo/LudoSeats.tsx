'use client';

import type { LudoState } from '@shared/games/types';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';
import { useGameActions } from '../useGameActions';
import { LUDO_PALETTE } from './palette';

/** The four color seats. Free seats can be taken before the game starts. */
export function LudoSeats({ state, selfId }: { state: LudoState; selfId: string | undefined }) {
  const { act } = useGameActions();
  const seated = state.seats.some((s) => s.playerId === selfId);
  return (
    <ul className="grid grid-cols-2 gap-2" aria-label="Seats">
      {state.seats.map((seat) => {
        const pal = LUDO_PALETTE[seat.color];
        const isTurn = state.phase === 'playing' && state.turn === seat.color;
        return (
          <li
            key={seat.color}
            className={cn('flex items-center gap-2 rounded-2xl bg-surface-2 p-2', isTurn && 'ring-2 ring-purple', state.phase !== 'lobby' && !seat.active && 'opacity-50')}
          >
            <span aria-hidden className="h-6 w-6 shrink-0 rounded-full border-2" style={{ background: pal.fill, borderColor: pal.stroke }} />
            <div className="min-w-0 flex-1">
              {seat.playerId ? (
                <div className="flex items-center gap-1.5">
                  <Avatar avatar={seat.avatar} size="sm" />
                  <span className="truncate text-sm font-bold">{seat.name}</span>
                </div>
              ) : state.phase === 'lobby' && !seated ? (
                <Button size="sm" variant="secondary" onClick={() => act({ type: 'sit', color: seat.color })}>
                  Sit here
                </Button>
              ) : (
                <span className="text-sm text-ink-soft">{state.phase === 'lobby' ? 'Open seat' : 'Empty'}</span>
              )}
              <p className="text-xs text-ink-soft">
                {pal.label}
                {isTurn && ' · rolling now'}
                {seat.playerId === selfId && seat.playerId && ' · you'}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
