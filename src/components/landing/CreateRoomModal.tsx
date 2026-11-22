'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Sparkles } from 'lucide-react';
import { LIMITS } from '@shared/constants';
import type { AvatarId, ThemeId } from '@shared/protocol';
import { sanitizeName, validPassword } from '@shared/validate';
import { ProfilePicker } from '@/components/room/ProfilePicker';
import { ThemePicker } from '@/components/room/ThemePicker';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { loadIdentity, randomAvatar } from '@/lib/identity/identity';
import { useRoomController } from '@/lib/room/RoomProvider';
import { TransportError } from '@/lib/signaling/types';

function CreateForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const controller = useRoomController();
  const id = useId();
  const [identity] = useState(() => loadIdentity());
  const [roomName, setRoomName] = useState('');
  const [theme, setTheme] = useState<ThemeId>('strawberry');
  const [name, setName] = useState(identity?.displayName ?? '');
  const [avatar, setAvatar] = useState<AvatarId>(() => identity?.avatar ?? randomAvatar());
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cleanRoom = sanitizeName(roomName, LIMITS.roomNameMax);
    const cleanName = sanitizeName(name, LIMITS.displayNameMax);
    if (!cleanRoom) return setError('Give your room a name (up to 40 characters).');
    if (!cleanName) return setError('Tell us your name (up to 24 characters).');
    if (usePassword && !validPassword(password)) return setError('A password needs 4 to 64 characters.');
    setError(null);
    setBusy(true);
    try {
      const code = await controller.createRoom({
        name: cleanRoom,
        theme,
        displayName: cleanName,
        avatar,
        ...(usePassword ? { password } : {}),
      });
      onDone();
      router.push(`/room/${code}`);
    } catch (err) {
      setBusy(false);
      if (err instanceof TransportError && err.code === 'server_busy') setError('Moonie is busy right now. Try again in a moment.');
      else if (err instanceof TransportError && err.code === 'network') setError(err.message);
      else setError(err instanceof Error ? err.message : 'Could not create the room.');
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <label htmlFor={`${id}-room`} className="mb-1 block text-sm font-bold">
          Room name
        </label>
        <input
          id={`${id}-room`}
          className="input-soft"
          value={roomName}
          maxLength={LIMITS.roomNameMax}
          placeholder="Friday movie night"
          onChange={(e) => setRoomName(e.target.value)}
        />
      </div>
      <ThemePicker value={theme} onChange={setTheme} />
      <ProfilePicker name={name} avatar={avatar} onName={setName} onAvatar={setAvatar} />
      <div>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-bold">
          <input type="checkbox" className="h-4 w-4 accent-[rgb(184_164_240)]" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} />
          <Lock size={15} aria-hidden /> Add a room password (optional)
        </label>
        {usePassword && (
          <input
            type="password"
            className="input-soft mt-2"
            value={password}
            maxLength={LIMITS.passwordMax}
            placeholder="At least 4 characters"
            autoComplete="new-password"
            aria-label="Room password"
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-2xl bg-pink/30 px-4 py-2 text-sm font-semibold">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" loading={busy} icon={<Sparkles size={18} />}>
        Create room
      </Button>
    </form>
  );
}

export function CreateRoomModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Create a room ✨">
      {open && <CreateForm onDone={onClose} />}
    </Modal>
  );
}
