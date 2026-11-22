'use client';

import { Component, type ReactNode } from 'react';
import Link from 'next/link';
import { ErrorState } from './ErrorState';

interface State {
  failed: boolean;
}

/** Catches render errors inside the room so one broken panel does not blank the whole page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error('Moonie room error:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <ErrorState emoji="🙈" title="Something went wrong in this room" text="Reload the page to jump back in. Your room is still there.">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full bg-gradient-to-r from-pink to-lavender px-6 py-3 font-display font-bold text-[rgb(61_44_92)] shadow-soft"
        >
          Reload
        </button>
        <Link href="/" className="font-bold text-ink-soft hover:text-ink">
          Back home
        </Link>
      </ErrorState>
    );
  }
}
