'use client';

import { useState } from 'react';
import { Lock, Save, Settings, Unlock } from 'lucide-react';
import { LIMITS } from '@shared/constants';
import type { AvatarId, RoomSettings, ThemeId } from '@shared/protocol';
import { sanitizeName, validPassword } from '@shared/validate';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { saveIdentity } from '@/lib/identity/identity';
import { useRoom, useRoomController } from '@/lib/room/RoomProvider';
import { ProfilePicker } from './ProfilePicker';
import { ThemePicker } from './ThemePicker';

const RULES: { key: keyof RoomSettings; label: string; hint: string }[] = [
  { key: 'requireApproval', label: 'Approval required for suggestions', hint: 'Videos members add wait for a host or co-host.' },
  { key: 'autoNext', label: 'Auto-play next video', hint: 'The next queued video starts when one ends.' },
  { key: 'coHostsCanKick', label: 'Co-hosts can remove people', hint: 'Co-hosts may remove members from the room.' },
];

/** The three room rules. The host flips them; everyone else sees them read-only. */
function RoomRules({ editable, settings }: { editable: boolean; settings: RoomSettings }) {
  const controller = useRoomController();
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-bold">Room rules</legend>
      {RULES.map((r) => (
        <label key={r.key} className="flex items-start gap-3 rounded-2xl bg-surface-2 px-3 py-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(167_139_250)]"
            checked={settings[r.key]}
            disabled={!editable}
            onChange={(e) => controller.transport.send({ type: 'room:settings', [r.key]: e.target.checked })}
          />
          <span>
            <span className="block font-bold">{r.label}</span>
            <span className="block text-xs text-ink-soft">{r.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function SettingsForm({ onDone }: { onDone: () => void }) {
  const controller = useRoomController();
  const toast = useToast();
  const snapshot = useRoom((s) => s.snapshot);
  const selfId = useRoom((s) => s.selfId);
  const self = snapshot?.participants.find((p) => p.id === selfId);
  const isHost = !!snapshot && snapshot.hostId === selfId;

  const [roomName, setRoomName] = useState(snapshot?.name ?? '');
  const [theme, setTheme] = useState<ThemeId>(snapshot?.theme ?? 'strawberry');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(self?.name ?? '');
  const [avatar, setAvatar] = useState<AvatarId>(self?.avatar ?? 'cat');
  const [error, setError] = useState<string | null>(null);

  if (!snapshot) return null;

  function saveProfile() {
    const displayName = sanitizeName(name, LIMITS.displayNameMax);
    if (!displayName) return setError('Tell us your name (up to 24 characters).');
    saveIdentity({ displayName, avatar });
    controller.transport.send({ type: 'profile:update', displayName, avatar });
    setError(null);
    toast.show('Profile updated');
  }

  function saveRoom() {
    const cleanName = sanitizeName(roomName, LIMITS.roomNameMax);
    if (!cleanName) return setError('Room name must be 1 to 40 characters.');
    if (password && !validPassword(password)) return setError('A password needs 4 to 64 characters.');
    controller.transport.send({
      type: 'room:settings',
      name: cleanName,
      theme,
      ...(password ? { password } : {}),
    });
    setError(null);
    toast.show('Room settings saved');
    onDone();
  }

  function clearPassword() {
    controller.transport.send({ type: 'room:settings', password: null });
    toast.show('Password removed');
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-lg">Your profile</h3>
        <ProfilePicker name={name} avatar={avatar} onName={setName} onAvatar={setAvatar} />
        <Button size="sm" variant="secondary" icon={<Save size={15} />} onClick={saveProfile}>
          Save profile
        </Button>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg">Room</h3>
        {isHost ? (
          <>
            <div>
              <label htmlFor="settings-room-name" className="mb-1 block text-sm font-bold">
                Room name
              </label>
              <input id="settings-room-name" className="input-soft" value={roomName} maxLength={LIMITS.roomNameMax} onChange={(e) => setRoomName(e.target.value)} />
            </div>
            <ThemePicker value={theme} onChange={setTheme} />
            <div>
              <label htmlFor="settings-password" className="mb-1 flex items-center gap-1.5 text-sm font-bold">
                {snapshot.hasPassword ? <Lock size={15} aria-hidden /> : <Unlock size={15} aria-hidden />}
                {snapshot.hasPassword ? 'Change password' : 'Set a password (optional)'}
              </label>
              <input
                id="settings-password"
                type="password"
                className="input-soft"
                value={password}
                autoComplete="new-password"
                maxLength={LIMITS.passwordMax}
                placeholder="At least 4 characters"
                onChange={(e) => setPassword(e.target.value)}
              />
              {snapshot.hasPassword && (
                <Button size="sm" variant="ghost" className="mt-2" onClick={clearPassword}>
                  Remove password
                </Button>
              )}
            </div>
            <Button icon={<Save size={16} />} onClick={saveRoom}>
              Save room settings
            </Button>
          </>
        ) : (
          <dl className="space-y-1 rounded-2xl bg-surface-2 p-4 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-soft">Name</dt>
              <dd className="font-bold">{snapshot.name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-soft">Code</dt>
              <dd className="font-bold">{snapshot.code}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-soft">Password</dt>
              <dd className="font-bold">{snapshot.hasPassword ? 'Yes' : 'No'}</dd>
            </div>
            <p className="pt-2 text-ink-soft">Only the host can change the room settings.</p>
          </dl>
        )}
      </section>
      <RoomRules editable={isHost} settings={snapshot.settings} />
      {error && (
        <p role="alert" className="rounded-2xl bg-pink/30 px-4 py-2 text-sm font-semibold">
          {error}
        </p>
      )}
    </div>
  );
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Room settings ⚙️">
      {open && <SettingsForm onDone={onClose} />}
    </Modal>
  );
}

export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="ghost" icon={<Settings size={16} />} onClick={onClick} aria-label="Room settings">
      <span className="hidden md:inline">Settings</span>
    </Button>
  );
}
