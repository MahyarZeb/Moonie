import type { Color } from '@shared/games/types';

/** Pastel fill, deeper stroke, and a label for each Ludo color. The same colors are used by the board and the seat list. */
export const LUDO_PALETTE: Record<Color, { fill: string; stroke: string; label: string }> = {
  red: { fill: '#f8b4cc', stroke: '#d6578a', label: 'Pink' },
  green: { fill: '#b7ead2', stroke: '#4fae85', label: 'Mint' },
  yellow: { fill: '#fde9a6', stroke: '#d9a93a', label: 'Butter' },
  blue: { fill: '#b5dcf8', stroke: '#4c8fd0', label: 'Sky' },
};
