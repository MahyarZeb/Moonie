'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

/** A cheerful banner for a finished round. `children` holds the restart button. */
export function WinnerBanner({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      role="status"
      initial={reduce ? false : { scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className="space-y-2 rounded-3xl bg-gradient-to-r from-pink/50 to-lavender/50 p-4 text-center shadow-soft"
    >
      <p className="font-display text-xl font-extrabold">{title}</p>
      {subtitle && <p className="text-sm text-ink-soft">{subtitle}</p>}
      {children}
    </motion.div>
  );
}
