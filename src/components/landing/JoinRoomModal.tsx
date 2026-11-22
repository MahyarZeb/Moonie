'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { DoorOpen } from 'lucide-react';
import { parseRoomInput } from '@shared/roomCode';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

function JoinForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const code = parseRoomInput(value);
    if (!code) return setError('That does not look like a room code or invite link. Codes have 6 letters and numbers.');
    onDone();
    router.push(`/room/${code}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-ink-soft">Paste the invite link or type the 6-character room code.</p>
      <div>
        <label htmlFor={`${id}-code`} className="mb-1 block text-sm font-bold">
          Room code or invite link
        </label>
        <input
          id={`${id}-code`}
          className="input-soft font-display text-lg tracking-wide"
          value={value}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ABC234 or https://…/room/ABC234"
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
        />
      </div>
      {error && (
        <p role="alert" className="rounded-2xl bg-pink/30 px-4 py-2 text-sm font-semibold">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" icon={<DoorOpen size={18} />}>
        Take me there
      </Button>
    </form>
  );
}

export function JoinRoomModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Join a room 💌">
      {open && <JoinForm onDone={onClose} />}
    </Modal>
  );
}
