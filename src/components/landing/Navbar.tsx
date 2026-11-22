'use client';

import { LogIn, Plus } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

export function Navbar({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/40 bg-bg/70 backdrop-blur-md dark:border-white/10">
      <nav aria-label="Main" className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Logo />
        <div className="hidden items-center gap-6 text-sm font-bold text-ink-soft md:flex">
          <a className="transition hover:text-ink" href="#features">
            Features
          </a>
          <a className="transition hover:text-ink" href="#how-it-works">
            How it works
          </a>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="secondary" size="sm" icon={<LogIn size={16} />} onClick={onJoin} className="hidden sm:inline-flex">
            Join room
          </Button>
          <Button size="sm" icon={<Plus size={16} />} onClick={onCreate}>
            Create room
          </Button>
        </div>
      </nav>
    </header>
  );
}
