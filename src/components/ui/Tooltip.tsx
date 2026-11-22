import type { ReactNode } from 'react';

/** CSS-only tooltip. The wrapped control keeps its own accessible name; this only adds a hover and focus hint. */
export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute -top-9 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-xl bg-ink px-2.5 py-1 text-xs font-semibold text-bg opacity-0 shadow-soft transition group-focus-within:opacity-100 group-hover:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
