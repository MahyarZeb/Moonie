'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { TttState } from '@shared/games/types';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';
import { WinnerBanner } from '../WinnerBanner';
import { useGameActions } from '../useGameActions';

const MARK_STYLE = { X: 'text-purple', O: 'text-pink' } as const;

export function TicTacToeBoard({ state, selfId, isHost }: { state: TttState; selfId: string | undefined; isHost: boolean }) {
  const { act } = useGameActions();
  const reduce = useReducedMotion();
  const myMark = state.seats.X?.playerId === selfId ? 'X' : state.seats.O?.playerId === selfId ? 'O' : null;
  const myTurn = state.status === 'playing' && myMark === state.turn;
  const canRestart = myMark !== null || isHost;
  const turnSeat = state.seats[state.turn];

  const status =
    state.status === 'waiting'
      ? 'Waiting for two players to sit down'
      : state.status === 'playing'
        ? myTurn
          ? "Your turn! Pick a square"
          : `${turnSeat?.name ?? state.turn}'s turn (${state.turn})`
        : state.status === 'draw'
          ? "It's a draw 🤝"
          : '';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {(['X', 'O'] as const).map((mark) => {
          const seat = state.seats[mark];
          return (
            <div
              key={mark}
              className={cn(
                'flex items-center gap-2 rounded-2xl bg-surface-2 p-2.5',
                state.status === 'playing' && state.turn === mark && 'ring-2 ring-purple',
              )}
            >
              <span className={cn('font-display text-2xl font-extrabold', MARK_STYLE[mark])}>{mark}</span>
              <div className="min-w-0 flex-1">
                {seat ? (
                  <div className="flex items-center gap-1.5">
                    <Avatar avatar={seat.avatar} size="sm" />
                    <span className="truncate text-sm font-bold">{seat.name}</span>
                  </div>
                ) : myMark === null ? (
                  <Button size="sm" variant="secondary" onClick={() => act({ type: 'sit', mark })}>
                    Sit as {mark}
                  </Button>
                ) : (
                  <span className="text-sm text-ink-soft">Open seat</span>
                )}
                <p className="text-xs text-ink-soft">{state.scores[mark]} wins</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mx-auto grid w-full max-w-[300px] grid-cols-3 gap-2" role="grid" aria-label="Tic-Tac-Toe board">
        {state.board.map((cell, i) => {
          const inLine = state.line?.includes(i) ?? false;
          const canPlay = myTurn && cell === null;
          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              disabled={!canPlay}
              aria-label={`Square ${i + 1}${cell ? `, ${cell}` : ', empty'}`}
              onClick={() => act({ type: 'move', index: i })}
              className={cn(
                'flex aspect-square items-center justify-center rounded-2xl bg-surface-2 font-display text-4xl font-extrabold transition',
                canPlay && 'hover:-translate-y-0.5 hover:bg-lavender/30',
                inLine && 'bg-pink/50 ring-2 ring-pink',
                !canPlay && 'cursor-default',
              )}
            >
              {cell && (
                <motion.span
                  key={cell}
                  initial={reduce ? false : { scale: 0, rotate: -20 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                  className={MARK_STYLE[cell]}
                >
                  {cell}
                </motion.span>
              )}
            </button>
          );
        })}
      </div>

      {status && (
        <p className="text-center text-sm font-bold" aria-live="polite">
          {status}
        </p>
      )}
      {state.status === 'won' && state.winner && (
        <WinnerBanner
          title={`🎉 ${state.seats[state.winner]?.name ?? state.winner} wins!`}
          subtitle={`${state.winner} takes the round`}
        >
          {canRestart && (
            <Button size="sm" onClick={() => act({ type: 'restart' })}>
              Play again
            </Button>
          )}
        </WinnerBanner>
      )}
      {state.status === 'draw' && canRestart && (
        <div className="text-center">
          <Button size="sm" onClick={() => act({ type: 'restart' })}>
            Play again
          </Button>
        </div>
      )}
      {myMark === null && state.status === 'playing' && <p className="text-center text-xs text-ink-soft">You are watching 👀</p>}
    </div>
  );
}
