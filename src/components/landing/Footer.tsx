import { Logo } from '@/components/Logo';

export function Footer() {
  return (
    <footer className="mt-10 border-t border-white/50 bg-surface/50 dark:border-white/10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-ink-soft sm:flex-row sm:px-6">
        <Logo href={null} />
        <p className="text-center">Rooms are temporary. Nothing is saved when everyone leaves. Made with 💜 for sleepovers.</p>
        <div className="flex gap-4 font-bold">
          <a className="hover:text-ink" href="#features">
            Features
          </a>
          <a className="hover:text-ink" href="#how-it-works">
            How it works
          </a>
        </div>
      </div>
    </footer>
  );
}
