'use client';

import { X } from 'lucide-react';
import type { GameView } from '@shared/games/types';
import { IconButton } from '@/components/ui/IconButton';
import { useRoom } from '@/lib/room/RoomProvider';
import { selectIsHost } from '@/lib/room/selectors';
import { GameHelp } from './GameHelp';
import { GamePicker } from './GamePicker';
import { LudoGame } from './ludo/LudoGame';
import { RpsPanel } from './rps/RpsPanel';
import { TicTacToeBoard } from './tictactoe/TicTacToeBoard';
import { useGameActions } from './useGameActions';

const TITLES = { ludo: '🎲 Ludo', tictactoe: '❌ Tic-Tac-Toe', rps: '✊ Rock Paper Scissors' } as const;

function seatedIds(g: GameView): string[] {
  if (g.kind === 'ludo') return g.seats.flatMap((s) => (s.playerId ? [s.playerId] : []));
  if (g.kind === 'tictactoe') return [g.seats.X?.playerId, g.seats.O?.playerId].filter((x): x is string => !!x);
  return g.players.map((p) => p.id);
}

/** The Games tab: a picker when nothing is open, otherwise the open game. All state comes from the server. */
export function GamesPanel() {
  const game = useRoom((s) => s.snapshot?.game ?? null);
  const selfId = useRoom((s) => s.selfId);
  const isHost = useRoom(selectIsHost);
  const { close } = useGameActions();

  if (!game) return <GamePicker />;
  const canClose = isHost || (!!selfId && seatedIds(game).includes(selfId));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-lg font-extrabold">{TITLES[game.kind]}</h3>
        {canClose && (
          <IconButton label="Close game" onClick={close}>
            <X size={16} />
          </IconButton>
        )}
      </div>
      <GameHelp kind={game.kind} />
      {game.kind === 'ludo' ? (
        <LudoGame state={game} selfId={selfId} isHost={isHost} />
      ) : game.kind === 'tictactoe' ? (
        <TicTacToeBoard state={game} selfId={selfId} isHost={isHost} />
      ) : (
        <RpsPanel state={game} selfId={selfId} />
      )}
    </div>
  );
}
