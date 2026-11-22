'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Crown, DoorOpen, Lock, Users } from 'lucide-react';
import { motion } from 'motion/react';
import type { AvatarId, RoomPeek } from '@shared/protocol';
import { LIMITS } from '@shared/constants';
import { sanitizeName } from '@shared/validate';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { Logo } from '@/components/Logo';
import { loadIdentity, randomAvatar } from '@/lib/identity/identity';
import { useRoom, useRoomController } from '@/lib/room/RoomProvider';
import { TransportError } from '@/lib/signaling/types';
import { getRoomTheme } from '@/lib/theme/roomThemes';
import { ErrorState } from './ErrorState';
import { InvitePanel } from './InviteButton';
import { ProfilePicker } from './ProfilePicker';
import { RoomThemeBackdrop } from './RoomThemeBackdrop';

const PEEK_INTERVAL_MS = 5000;

function joinErrorText(err: unknown): string {
  if (err instanceof TransportError) {
    switch (err.code) {
      case 'wrong_password':
        return 'That password is not right. Try again.';
      case 'locked_out':
        return 'Too many wrong passwords. Wait a little and try again.';
      case 'room_full':
        return 'This room is full right now (someone may be reconnecting). Try again in a moment.';
      case 'not_found':
        return 'This room does not exist anymore.';
      case 'network':
      case 'timeout':
        return 'Could not reach Moonie. Check your connection and try again.';
      case 'rate_limited':
        return 'Slow down a little, then try again.';
      default:
        return err.message;
    }
  }
  return 'Could not join the room.';
}

export function Lobby({ code }: { code: string }) {
  const controller = useRoomController();
  const phase = useRoom((s) => s.phase);
  const peek = useRoom((s) => s.peek);
  const peekError = useRoom((s) => s.peekError);
  const snapshot = useRoom((s) => s.snapshot);
  const selfId = useRoom((s) => s.selfId);
  const joinedAsCreator = phase === 'in-room' && !!snapshot;

  // Live peek: re-check the room every 5 s while this tab is visible. There is no server-side subscription.
  useEffect(() => {
    if (joinedAsCreator || phase === 'ended') return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void controller.peek(code);
    }, PEEK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [controller, code, joinedAsCreator, phase]);

  // After the room closed under us the lobby has nothing to show yet, so look it up right away.
  useEffect(() => {
    if (phase === 'lobby' && !peek && !peekError) void controller.peek(code);
  }, [controller, code, phase, peek, peekError]);

  if (peekError && !peek && !snapshot) {
    if (peekError.code === 'not_found') {
      return (
        <LobbyFrame>
          <ErrorState emoji="🔍" title="Room not found" text={`We could not find a room with the code ${code}. It may have ended, or the code has a typo.`}>
            <Link
              href="/"
              className="rounded-full bg-gradient-to-r from-pink to-lavender px-6 py-3 text-center font-display font-bold text-[rgb(61_44_92)] shadow-soft"
            >
              Back home
            </Link>
          </ErrorState>
        </LobbyFrame>
      );
    }
    return (
      <LobbyFrame>
        <ErrorState emoji="📡" title="Cannot reach Moonie" text={peekError.message || 'The connection to the server failed.'}>
          <Button onClick={() => void controller.retry(code)}>Try again</Button>
          <Link href="/" className="text-center font-bold text-ink-soft hover:text-ink">
            Back home
          </Link>
        </ErrorState>
      </LobbyFrame>
    );
  }

  if (joinedAsCreator && snapshot) {
    return (
      <LobbyFrame theme={snapshot.theme}>
        <LobbyCard
          code={code}
          name={snapshot.name}
          emoji={getRoomTheme(snapshot.theme).emoji}
          hostName={snapshot.participants.find((p) => p.id === snapshot.hostId)?.name ?? 'Someone'}
          hasPassword={snapshot.hasPassword}
          people={snapshot.participants.filter((p) => p.connected).map((p) => ({ name: p.name, avatar: p.avatar }))}
          count={snapshot.participants.filter((p) => p.connected).length}
          max={snapshot.maxParticipants}
          selfName={snapshot.participants.find((p) => p.id === selfId)?.name}
        >
          <InvitePanel code={code} />
          <Button size="lg" className="w-full" icon={<DoorOpen size={18} />} onClick={() => controller.enter()}>
            Enter room
          </Button>
        </LobbyCard>
      </LobbyFrame>
    );
  }

  if (!peek) {
    return (
      <LobbyFrame>
        <div className="card-soft mx-auto flex w-full max-w-md flex-col items-center gap-3 p-10 text-center">
          <Spinner size={32} />
          <p className="font-bold text-ink-soft">Peeking into room {code}…</p>
        </div>
      </LobbyFrame>
    );
  }

  return (
    <LobbyFrame theme={peek.theme}>
      <GuestLobby code={code} peek={peek} joining={phase === 'joining'} />
    </LobbyFrame>
  );
}

function GuestLobby({ code, peek, joining }: { code: string; peek: RoomPeek; joining: boolean }) {
  const controller = useRoomController();
  const id = useId();
  const [identity] = useState(() => loadIdentity());
  const [name, setName] = useState(identity?.displayName ?? '');
  const [avatar, setAvatar] = useState<AvatarId>(() => identity?.avatar ?? randomAvatar());
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const displayName = sanitizeName(name, LIMITS.displayNameMax);
    if (!displayName) return setError('Tell us your name (up to 24 characters).');
    if (peek.hasPassword && !password) return setError('This room needs a password.');
    setError(null);
    try {
      await controller.joinRoom({ code, displayName, avatar, ...(peek.hasPassword ? { password } : {}) });
    } catch (err) {
      setError(joinErrorText(err));
    }
  }

  const full = peek.count >= peek.max;
  return (
    <LobbyCard
      code={code}
      name={peek.name}
      emoji={getRoomTheme(peek.theme).emoji}
      hostName={peek.hostName}
      hasPassword={peek.hasPassword}
      people={peek.participants}
      count={peek.count}
      max={peek.max}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <ProfilePicker name={name} avatar={avatar} onName={setName} onAvatar={setAvatar} />
        {peek.hasPassword && (
          <div>
            <label htmlFor={`${id}-pw`} className="mb-1 flex items-center gap-1.5 text-sm font-bold">
              <Lock size={15} aria-hidden /> Room password
            </label>
            <input
              id={`${id}-pw`}
              type="password"
              className="input-soft"
              value={password}
              autoComplete="off"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}
        {full && !error && <p className="rounded-2xl bg-sky/40 px-4 py-2 text-sm font-semibold">This room looks full. You can still try to enter.</p>}
        {error && (
          <p role="alert" className="rounded-2xl bg-pink/30 px-4 py-2 text-sm font-semibold">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={joining} icon={<DoorOpen size={18} />}>
          Enter room
        </Button>
      </form>
    </LobbyCard>
  );
}

function LobbyCard({
  code,
  name,
  emoji,
  hostName,
  hasPassword,
  people,
  count,
  max,
  selfName,
  children,
}: {
  code: string;
  name: string;
  emoji: string;
  hostName: string;
  hasPassword: boolean;
  /** Undefined for password rooms, which only reveal the count. */
  people?: { name: string; avatar: AvatarId }[];
  count: number;
  max: number;
  selfName?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="card-soft mx-auto w-full max-w-lg space-y-5 p-6 sm:p-8">
      <div className="text-center">
        <div className="text-5xl" aria-hidden>
          {emoji}
        </div>
        <h1 className="mt-2 text-3xl">{name}</h1>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Badge tone="lavender">Code {code}</Badge>
          <Badge tone="pink">
            <Crown size={12} aria-hidden /> Host: {hostName}
          </Badge>
          {hasPassword && (
            <Badge tone="blue">
              <Lock size={12} aria-hidden /> Password
            </Badge>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-surface-2 p-4">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink-soft">
          <Users size={15} aria-hidden /> {count} of {max} here now
        </div>
        {people && people.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {people.map((p, i) => (
              <li key={`${p.name}-${i}`} className="flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-sm font-bold">
                <Avatar avatar={p.avatar} size="sm" /> {p.name}
                {p.name === selfName && <span className="text-ink-soft">(you)</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-soft">{hasPassword ? 'Names show up after you join.' : 'Nobody is here yet.'}</p>
        )}
      </div>
      {children}
    </motion.div>
  );
}

function LobbyFrame({ children, theme }: { children: React.ReactNode; theme?: Parameters<typeof getRoomTheme>[0] }) {
  return (
    <div data-room-theme={theme} className="relative min-h-dvh overflow-hidden">
      <RoomThemeBackdrop theme={theme} />
      <header className="relative z-10 mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="relative z-10 px-4 pb-16 pt-4">{children}</main>
    </div>
  );
}
