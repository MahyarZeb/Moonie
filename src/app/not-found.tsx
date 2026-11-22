import Link from 'next/link';
import { Logo } from '@/components/Logo';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <Logo />
      <div className="text-6xl" aria-hidden>
        🌙
      </div>
      <h1 className="text-3xl">This page drifted off into the clouds</h1>
      <p className="max-w-md text-ink-soft">We could not find what you were looking for. Let us take you back home.</p>
      <Link
        href="/"
        className="rounded-full bg-gradient-to-r from-pink to-lavender px-6 py-3 font-display font-bold text-[rgb(61_44_92)] shadow-soft transition hover:-translate-y-0.5"
      >
        Back to Moonie
      </Link>
    </main>
  );
}
