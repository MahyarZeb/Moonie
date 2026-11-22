'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { KeyboardEvent } from 'react';
import {
  COLORS,
  FINISH_COORDS,
  HOME_COLUMN_COORDS,
  SAFE_SQUARES,
  START,
  TRACK_COORDS,
  pieceCoord,
} from '@shared/games/ludo';
import type { Color, LudoState } from '@shared/games/types';
import { LUDO_PALETTE } from './palette';

const BASE_ORIGIN: Record<Color, { x: number; y: number }> = {
  red: { x: 0, y: 0 },
  green: { x: 9, y: 0 },
  yellow: { x: 9, y: 9 },
  blue: { x: 0, y: 9 },
};

/** Offsets pieces that share a spot so stacks stay visible. */
function stackOffset(index: number, count: number): { dx: number; dy: number } {
  if (count <= 1) return { dx: 0, dy: 0 };
  const angle = (index / count) * Math.PI * 2;
  return { dx: Math.cos(angle) * 0.22, dy: Math.sin(angle) * 0.22 };
}

/** The SVG board. Highlights the pieces in `legal` and reports clicks on them. */
export function LudoBoard({
  state,
  legal,
  onMove,
}: {
  state: LudoState;
  legal: number[];
  onMove: (piece: number) => void;
}) {
  const reduce = useReducedMotion();
  const duration = reduce ? 0 : 0.3;

  type Token = { color: Color; piece: number; x: number; y: number };
  const tokens: Token[] = [];
  for (const color of COLORS) {
    state.pieces[color].forEach((p, piece) => {
      const c = pieceCoord(color, piece, p);
      tokens.push({ color, piece, x: c.x, y: c.y });
    });
  }
  const groups = new Map<string, Token[]>();
  for (const t of tokens) {
    const key = `${t.x.toFixed(2)},${t.y.toFixed(2)}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  return (
    <svg viewBox="0 0 15 15" role="group" aria-label="Ludo board" className="mx-auto block w-full max-w-[420px] touch-manipulation rounded-3xl bg-surface-2 shadow-soft">
      {COLORS.map((c) => {
        const o = BASE_ORIGIN[c];
        return (
          <g key={c}>
            <rect x={o.x + 0.2} y={o.y + 0.2} width={5.6} height={5.6} rx={1} fill={LUDO_PALETTE[c].fill} opacity={0.55} />
            <rect x={o.x + 1} y={o.y + 1} width={4} height={4} rx={0.8} fill="rgb(var(--surface))" opacity={0.8} />
          </g>
        );
      })}

      {TRACK_COORDS.map((p, i) => {
        const start = COLORS.find((c) => START[c] === i);
        const safe = SAFE_SQUARES.includes(i);
        return (
          <g key={i}>
            <rect
              x={p.x + 0.05}
              y={p.y + 0.05}
              width={0.9}
              height={0.9}
              rx={0.2}
              fill={start ? LUDO_PALETTE[start].fill : 'rgb(var(--surface))'}
              stroke="rgb(var(--lavender))"
              strokeWidth={0.06}
            />
            {safe && (
              <text x={p.x + 0.5} y={p.y + 0.5} fontSize={0.55} textAnchor="middle" dominantBaseline="central" fill={start ? LUDO_PALETTE[start].stroke : 'rgb(var(--purple))'} aria-hidden>
                ★
              </text>
            )}
          </g>
        );
      })}

      {COLORS.map((c) =>
        HOME_COLUMN_COORDS[c].map((p, i) => (
          <rect key={`${c}${i}`} x={p.x + 0.05} y={p.y + 0.05} width={0.9} height={0.9} rx={0.2} fill={LUDO_PALETTE[c].fill} stroke={LUDO_PALETTE[c].stroke} strokeWidth={0.05} />
        )),
      )}

      {COLORS.map((c) => (
        <rect key={`f${c}`} x={FINISH_COORDS[c].x + 0.05} y={FINISH_COORDS[c].y + 0.05} width={0.9} height={0.9} rx={0.3} fill={LUDO_PALETTE[c].stroke} opacity={0.7} />
      ))}
      <text x={7.5} y={7.5} fontSize={0.9} textAnchor="middle" dominantBaseline="central" aria-hidden>
        🌙
      </text>

      {[...groups.values()].flatMap((group) =>
        group.map((t, i) => {
          const { dx, dy } = stackOffset(i, group.length);
          const isLegal = t.color === state.turn && legal.includes(t.piece);
          const pal = LUDO_PALETTE[t.color];
          return (
            <motion.g
              key={`${t.color}${t.piece}`}
              initial={false}
              animate={{ x: t.x + dx, y: t.y + dy }}
              transition={{ duration, ease: 'easeOut' }}
              onClick={isLegal ? () => onMove(t.piece) : undefined}
              onKeyDown={isLegal ? (e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && onMove(t.piece) : undefined}
              tabIndex={isLegal ? 0 : undefined}
              role={isLegal ? 'button' : undefined}
              aria-label={isLegal ? `Move ${pal.label} piece ${t.piece + 1}` : undefined}
              style={{ cursor: isLegal ? 'pointer' : 'default' }}
            >
              {isLegal && (
                <circle r={0.5} fill="none" stroke={pal.stroke} strokeWidth={0.1} className="animate-pulse" />
              )}
              <circle r={0.34} fill={pal.fill} stroke={pal.stroke} strokeWidth={0.1} />
              <circle r={0.12} cx={-0.1} cy={-0.1} fill="#fff" opacity={0.7} />
            </motion.g>
          );
        }),
      )}
    </svg>
  );
}
