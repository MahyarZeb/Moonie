import { THREE_SIXES_FORFEIT } from '@shared/games/ludo';
import type { GameKind } from '@shared/games/types';

const HELP: Record<GameKind, string[]> = {
  ludo: [
    '2 to 4 players take a color seat, then anyone seated (or the host) starts the game.',
    'Roll a 6 to bring a piece out of base. A 6 also gives you another roll.',
    'Land on an opponent to send their piece back to base, except on safe squares (the star squares).',
    'You need an exact roll to reach the center. Get all 4 pieces home to win.',
  ],
  tictactoe: [
    'Two players sit as X and O. Everyone else watches.',
    'Take turns marking a square. Three in a row wins.',
    'Restart swaps who goes first and keeps the score.',
  ],
  rps: [
    'Join the table (2 to 8 players), then start a round.',
    'Everyone picks in secret. Picks are revealed when the last player has chosen.',
    'If two different choices are in play, the winning choice scores a point. All three, or all the same, is a draw.',
  ],
};

export function GameHelp({ kind }: { kind: GameKind }) {
  const lines = kind === 'ludo' && THREE_SIXES_FORFEIT
    ? [...HELP.ludo, 'House rule: rolling three 6s in a row forfeits that move and passes the turn.']
    : HELP[kind];
  return (
    <details className="rounded-2xl bg-surface-2 px-4 py-2 text-sm">
      <summary className="cursor-pointer font-bold text-ink-soft">How to play</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </details>
  );
}
