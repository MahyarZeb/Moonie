'use client';

import { legalMoves } from '@shared/games/ludo';
import type { LudoState } from '@shared/games/types';
import { Button } from '@/components/ui/Button';
import { WinnerBanner } from '../WinnerBanner';
import { useGameActions } from '../useGameActions';
import { Dice } from './Dice';
import { LudoBoard } from './LudoBoard';
import { LudoSeats } from './LudoSeats';
import { LUDO_PALETTE } from './palette';

export function LudoGame({ state, selfId, isHost }: { state: LudoState; selfId: string | undefined; isHost: boolean }) {
  const { act } = useGameActions();
  const mySeat = state.seats.find((s) => s.playerId === selfId);
  const turnSeat = state.turn ? state.seats.find((s) => s.color === state.turn) : undefined;
  const myTurn = state.phase === 'playing' && !!mySeat && mySeat.color === state.turn;
  const legal = myTurn && state.dice !== null && state.turn ? legalMoves(state, state.turn, state.dice) : [];
  const occupied = state.seats.filter((s) => s.playerId).length;
  const canStart = state.phase === 'lobby' && occupied >= 2 && (!!mySeat || isHost);
  const canRestart = state.phase === 'finished' ? !!mySeat || isHost : isHost;
  const shownDice = state.dice ?? state.lastRoll?.value ?? null;
  const winnerSeat = state.winner ? state.seats.find((s) => s.color === state.winner) : undefined;

  return (
    <div className="space-y-4">
      <LudoSeats state={state} selfId={selfId} />

      {state.phase === 'lobby' && (
        <div className="space-y-2 text-center">
          <p className="text-sm text-ink-soft">{occupied < 2 ? 'Sit down and wait for at least one more player' : 'Ready when you are!'}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" disabled={!canStart} onClick={() => act({ type: 'start' })}>
              Start game
            </Button>
            {mySeat && (
              <Button size="sm" variant="secondary" onClick={() => act({ type: 'leaveSeat' })}>
                Leave seat
              </Button>
            )}
          </div>
        </div>
      )}

      {state.phase !== 'lobby' && (
        <>
          <LudoBoard state={state} legal={legal} onMove={(piece) => act({ type: 'move', piece })} />
          <div className="flex items-center gap-3 rounded-3xl bg-surface-2 p-3">
            <Dice value={shownDice} rollId={state.rollId} active={myTurn} />
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-sm font-bold" aria-live="polite">
                {state.phase === 'finished'
                  ? 'Game over'
                  : myTurn
                    ? state.dice === null
                      ? 'Your turn! Roll the dice'
                      : legal.length === 1
                        ? 'Move! Only one piece can go'
                        : 'Pick a glowing piece to move'
                    : `${turnSeat?.name || (state.turn ? LUDO_PALETTE[state.turn].label : '')}'s turn`}
              </p>
              {state.phase === 'playing' && (
                <Button size="sm" disabled={!myTurn || state.dice !== null} onClick={() => act({ type: 'roll' })}>
                  Roll 🎲
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      {state.phase === 'finished' && (
        <WinnerBanner title={`🎉 ${winnerSeat?.name || (state.winner ? LUDO_PALETTE[state.winner].label : 'Someone')} wins!`}>
          {canRestart && (
            <Button size="sm" onClick={() => act({ type: 'restart' })}>
              Play again
            </Button>
          )}
        </WinnerBanner>
      )}

      {state.phase === 'playing' && !mySeat && <p className="text-center text-xs text-ink-soft">You are watching 👀</p>}
      {state.phase === 'playing' && isHost && (
        <div className="text-center">
          <Button size="sm" variant="ghost" onClick={() => act({ type: 'restart' })}>
            Restart game
          </Button>
        </div>
      )}

      {state.log.length > 0 && (
        <ol className="max-h-24 space-y-0.5 overflow-y-auto rounded-2xl bg-surface-2 px-3 py-2 text-xs text-ink-soft" aria-label="Game log">
          {[...state.log].reverse().map((line, i) => (
            <li key={`${state.log.length - i}-${line}`}>{line}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
