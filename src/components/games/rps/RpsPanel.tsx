'use client';

import type { Choice, RpsView } from '@shared/games/types';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';
import { WinnerBanner } from '../WinnerBanner';
import { useGameActions } from '../useGameActions';

const EMOJI: Record<Choice, string> = { rock: '✊', paper: '✋', scissors: '✌️' };
const CHOICES: Choice[] = ['rock', 'paper', 'scissors'];
const MAX_PLAYERS = 8;

export function RpsPanel({ state, selfId }: { state: RpsView; selfId: string | undefined }) {
  const { act } = useGameActions();
  const me = state.players.find((p) => p.id === selfId);
  const myPick = selfId ? state.picks[selfId] : undefined;
  const result = state.result;

  return (
    <div className="space-y-4">
      <ul className="space-y-1.5" aria-label="Players">
        {state.players.length === 0 && <li className="rounded-2xl bg-surface-2 p-3 text-center text-sm text-ink-soft">Nobody has joined yet</li>}
        {state.players.map((p) => {
          const pick = state.picks[p.id];
          const won = result?.winners.includes(p.id);
          return (
            <li key={p.id} className={cn('flex items-center gap-2 rounded-2xl bg-surface-2 p-2', won && 'ring-2 ring-pink')}>
              <Avatar avatar={p.avatar} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-bold">
                {p.name}
                {p.id === selfId && ' (you)'}
              </span>
              <span className="text-xs text-ink-soft">{p.score} pts</span>
              <span className="w-8 text-center text-xl" aria-label={pickLabel(pick)}>
                {state.phase === 'lobby' ? '' : pick === 'locked' ? '🔒' : pick === 'none' || pick === undefined ? '💭' : EMOJI[pick]}
              </span>
            </li>
          );
        })}
      </ul>

      {state.phase === 'lobby' && (
        <div className="flex flex-wrap justify-center gap-2">
          {!me && (
            <Button size="sm" disabled={state.players.length >= MAX_PLAYERS} onClick={() => act({ type: 'join' })}>
              Join the table
            </Button>
          )}
          {me && (
            <>
              <Button size="sm" disabled={state.players.length < 2} onClick={() => act({ type: 'start' })}>
                Start round
              </Button>
              <Button size="sm" variant="secondary" onClick={() => act({ type: 'leave' })}>
                Leave
              </Button>
            </>
          )}
          {me && state.players.length < 2 && <p className="w-full text-center text-xs text-ink-soft">Waiting for at least one more player</p>}
        </div>
      )}

      {state.phase === 'choosing' && (
        <div className="space-y-2">
          <p className="text-center text-sm font-bold" aria-live="polite">
            Round {state.round}: {me ? (myPick && myPick !== 'none' ? 'Picked! You can still change it' : 'Make your pick') : 'Players are choosing'}
          </p>
          {me ? (
            <div className="flex justify-center gap-2">
              {CHOICES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={myPick === c}
                  onClick={() => act({ type: 'pick', choice: c })}
                  className={cn(
                    'flex h-16 w-16 items-center justify-center rounded-3xl bg-surface-2 text-3xl transition hover:-translate-y-1 hover:shadow-soft',
                    myPick === c && 'bg-lavender/50 ring-2 ring-purple',
                  )}
                >
                  {EMOJI[c]}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-center text-xs text-ink-soft">You are watching 👀</p>
          )}
        </div>
      )}

      {state.phase === 'revealed' && result && (
        <WinnerBanner
          title={
            result.draw
              ? "It's a draw 🤝"
              : `🎉 ${result.winners.map((id) => state.players.find((p) => p.id === id)?.name ?? 'Someone').join(' & ')} won`
          }
          subtitle={result.winningChoice ? `${EMOJI[result.winningChoice]} ${result.winningChoice} wins the round` : 'Nobody scores this round'}
        >
          {me && (
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => act({ type: 'next' })}>
                Next round
              </Button>
              <Button size="sm" variant="secondary" onClick={() => act({ type: 'resetScores' })}>
                Reset scores
              </Button>
            </div>
          )}
        </WinnerBanner>
      )}
      {state.phase === 'revealed' && !me && (
        <div className="text-center">
          <Button size="sm" variant="secondary" disabled={state.players.length >= MAX_PLAYERS} onClick={() => act({ type: 'join' })}>
            Join the next round
          </Button>
        </div>
      )}
    </div>
  );
}

function pickLabel(pick: RpsView['picks'][string] | undefined): string {
  if (pick === 'locked') return 'Picked, hidden';
  if (pick === 'none' || pick === undefined) return 'No pick yet';
  return pick;
}
