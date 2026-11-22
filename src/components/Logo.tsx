import Link from 'next/link';
import { cn } from '@/lib/utils/cn';

/** Moonie wordmark with a smiling crescent moon. */
export function Logo({ className, href = '/' }: { className?: string; href?: string | null }) {
  const content = (
    <>
      <svg width="34" height="34" viewBox="0 0 40 40" aria-hidden className="shrink-0 drop-shadow-sm">
        <defs>
          <linearGradient id="moonie-moon" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffd6e5" />
            <stop offset="1" stopColor="#cdb4db" />
          </linearGradient>
        </defs>
        <path d="M27 5a16 16 0 1 0 8 27A13 13 0 0 1 27 5Z" fill="url(#moonie-moon)" />
        <circle cx="16" cy="21" r="1.6" fill="#4a3c63" />
        <path d="M13 26q3 3 6 0" stroke="#4a3c63" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <circle cx="12" cy="24" r="2" fill="#ffafcc" opacity=".8" />
        <path d="M33 8l1 2.5L36.5 11.5 34 12.5 33 15l-1-2.5-2.5-1L32 10.5Z" fill="#fff" opacity=".9" />
      </svg>
      <span className="font-display text-2xl font-bold tracking-tight">Moonie</span>
    </>
  );
  const classes = cn('inline-flex items-center gap-2 text-ink', className);
  return href ? (
    <Link href={href} className={classes} aria-label="Moonie home">
      {content}
    </Link>
  ) : (
    <span className={classes}>{content}</span>
  );
}
