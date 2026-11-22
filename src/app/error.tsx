'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Moonie error boundary:', error);
  }, [error]);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-6xl" aria-hidden>
        🙈
      </div>
      <h1 className="text-3xl">Oops, something went wrong</h1>
      <p className="max-w-md text-ink-soft">Moonie tripped over a pillow. You can try again, or head back home.</p>
      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/" className="rounded-full border-2 border-lavender/60 bg-surface-2 px-5 py-2.5 font-display font-bold">
          Go home
        </Link>
      </div>
    </main>
  );
}
