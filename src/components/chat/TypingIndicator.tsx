'use client';

/** "Mochi is typing…" line. Reserves its height so the list does not jump. */
export function TypingIndicator({ names }: { names: string[] }) {
  const text =
    names.length === 0
      ? ''
      : names.length === 1
        ? `${names[0]} is typing`
        : names.length === 2
          ? `${names[0]} and ${names[1]} are typing`
          : 'Several people are typing';
  return (
    <p className="h-5 truncate px-1 text-xs font-semibold text-ink-soft" aria-live="polite">
      {text && (
        <>
          {text}
          <span aria-hidden className="ml-0.5 inline-flex gap-0.5 align-middle">
            {[0, 150, 300].map((delay) => (
              <span key={delay} className="h-1 w-1 animate-bounce rounded-full bg-purple" style={{ animationDelay: `${delay}ms` }} />
            ))}
          </span>
        </>
      )}
    </p>
  );
}
