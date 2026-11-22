import { Spinner } from '@/components/ui/Spinner';

export default function Loading() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3">
      <div className="text-5xl" aria-hidden>
        🌙
      </div>
      <Spinner size={28} label="Loading room" />
      <p className="font-bold text-ink-soft">Getting the room ready…</p>
    </main>
  );
}
