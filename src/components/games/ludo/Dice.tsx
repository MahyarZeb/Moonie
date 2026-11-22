'use client';

import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils/cn';

const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

/** A die face. It tumbles whenever `rollId` changes. */
export function Dice({ value, rollId, active }: { value: number | null; rollId: number; active: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={rollId}
      role="img"
      aria-label={value ? `Dice shows ${value}` : 'Dice not rolled yet'}
      initial={reduce || rollId === 0 ? false : { rotate: -300, scale: 0.6 }}
      animate={{ rotate: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 14 }}
      className={cn(
        'relative grid h-16 w-16 shrink-0 grid-cols-3 grid-rows-3 gap-0.5 rounded-2xl bg-surface-2 p-2.5 shadow-soft',
        active && 'ring-2 ring-purple',
      )}
    >
      {value
        ? PIPS[value]!.map(([c, r]) => (
            <span key={`${c}${r}`} style={{ gridColumn: c + 1, gridRow: r + 1 }} className="m-auto h-2.5 w-2.5 rounded-full bg-purple" />
          ))
        : <span className="col-span-3 row-span-3 m-auto text-xl">🎲</span>}
    </motion.div>
  );
}
