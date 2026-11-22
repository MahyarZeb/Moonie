import type { ReactNode } from 'react';

/** A friendly full-card message used for room errors (not found, kicked, offline). */
export function ErrorState({
  emoji,
  title,
  text,
  children,
}: {
  emoji: string;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="card-soft mx-auto flex w-full max-w-md flex-col items-center gap-3 p-8 text-center">
      <div className="text-5xl" aria-hidden>
        {emoji}
      </div>
      <h2 className="text-2xl">{title}</h2>
      <p className="text-ink-soft">{text}</p>
      {children && <div className="mt-2 flex w-full flex-col gap-3">{children}</div>}
    </div>
  );
}
