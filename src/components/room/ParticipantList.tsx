'use client';

import { useState, useSyncExternalStore } from 'react';
import { Crown, Mic, MicOff, Star, StarOff, UserMinus } from 'lucide-react';
import { canActOn } from '@shared/permissions';
import type { Participant } from '@shared/protocol';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { IconButton } from '@/components/ui/IconButton';
import { useRoom, useRoomController } from '@/lib/room/RoomProvider';
import { selectSelfRole } from '@/lib/room/selectors';

const NO_LINKS: Record<string, RTCPeerConnectionState> = {};

function describeLink(state: RTCPeerConnectionState): string {
  if (state === 'connected') return 'Watching your stream';
  if (state === 'failed') return "Couldn't connect";
  if (state === 'disconnected') return 'Connection hiccup…';
  return 'Connecting…';
}

type Pending = { kind: 'promote' | 'demote' | 'transfer' | 'kick'; who: Participant };

const CONFIRM: Record<Pending['kind'], { title: string; label: string; destructive: boolean; text: (name: string) => string }> = {
  promote: {
    title: 'Promote to co-host?',
    label: 'Promote',
    destructive: false,
    text: (n) => `${n} will be able to control playback, manage the queue, moderate chat and run games.`,
  },
  demote: {
    title: 'Remove co-host?',
    label: 'Remove co-host',
    destructive: true,
    text: (n) => `${n} goes back to being a regular member.`,
  },
  transfer: {
    title: 'Transfer host?',
    label: 'Transfer host',
    destructive: true,
    text: (n) => `${n} becomes the host. You stay in the room as a co-host.`,
  },
  kick: {
    title: 'Remove from room?',
    label: 'Remove',
    destructive: true,
    text: (n) => `${n} will be taken out of the room. They can rejoin with the code.`,
  },
};

export function ParticipantList() {
  const controller = useRoomController();
  const snapshot = useRoom((s) => s.snapshot);
  const selfId = useRoom((s) => s.selfId);
  const selfRole = useRoom(selectSelfRole);
  const [pending, setPending] = useState<Pending | null>(null);
  const share = controller.share;
  const links = useSyncExternalStore(share.subscribe, () => share.getState().links, () => NO_LINKS);
  if (!snapshot) return null;
  const settings = snapshot.settings;
  const can = (p: Participant, action: Parameters<typeof canActOn>[2]) =>
    p.id !== selfId && canActOn(selfRole, p.role, action, settings);
  const media = snapshot.media;
  const sharerId = media?.kind === 'screen' || (media?.kind === 'local' && media.delivery === 'stream') ? (media.sharerId ?? null) : null;
  const sameFile = media?.kind === 'local' && media.delivery === 'same-file';
  const connected = snapshot.participants.filter((p) => p.connected).length;

  return (
    <div>
      <p className="mb-3 text-sm font-bold text-ink-soft" aria-live="polite">
        {connected} online{snapshot.participants.length > connected ? ` · ${snapshot.participants.length - connected} reconnecting` : ''}
      </p>
      <ul className="space-y-2">
        {snapshot.participants.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-surface-2 px-3 py-2">
            <Avatar avatar={p.avatar} dim={!p.connected} />
            <div className="min-w-[7rem] flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-bold">{p.name}</span>
                {p.id === selfId && <span className="text-xs font-semibold text-ink-soft">(you)</span>}
                {p.id === snapshot.hostId && (
                  <Badge tone="pink" className="whitespace-nowrap">
                    <Crown size={11} aria-hidden /> Host
                  </Badge>
                )}
                {p.id !== snapshot.hostId && p.role === 'co_host' && (
                  <Badge tone="lavender" className="whitespace-nowrap">
                    <Star size={11} aria-hidden /> Co-host
                  </Badge>
                )}
                {p.muted && <MicOff size={13} aria-label="Muted" className="text-ink-soft" />}
              </div>
              {!p.connected && <span className="text-xs text-ink-soft">Reconnecting…</span>}
              {p.connected && p.id === sharerId && <span className="text-xs text-ink-soft">{media?.kind === 'local' ? 'Streaming their video' : 'Sharing their screen'}</span>}
              {p.connected && sameFile && (
                <span className="text-xs text-ink-soft">{p.hasFile ? 'Has the file ✓' : 'Needs the file'}</span>
              )}
              {p.connected && p.id !== selfId && links[p.id] && (
                <span className="text-xs text-ink-soft">{describeLink(links[p.id]!)}</span>
              )}
            </div>
            <div className="ml-auto flex shrink-0 gap-1">
              {can(p, 'room.roles') && p.role === 'member' && (
                <IconButton label={`Promote ${p.name} to co-host`} className="h-8 w-8" onClick={() => setPending({ kind: 'promote', who: p })}>
                  <Star size={15} />
                </IconButton>
              )}
              {can(p, 'room.roles') && p.role === 'co_host' && (
                <IconButton label={`Remove ${p.name} as co-host`} className="h-8 w-8" onClick={() => setPending({ kind: 'demote', who: p })}>
                  <StarOff size={15} />
                </IconButton>
              )}
              {can(p, 'host.transfer') && (
                <IconButton label={`Make ${p.name} the host`} className="h-8 w-8" disabled={!p.connected} onClick={() => setPending({ kind: 'transfer', who: p })}>
                  <Crown size={15} />
                </IconButton>
              )}
              {can(p, 'chat.moderate') && (
                <IconButton
                  label={p.muted ? `Unmute ${p.name}` : `Mute ${p.name}`}
                  className="h-8 w-8"
                  onClick={() => controller.transport.send({ type: 'chat:mute', id: p.id, muted: !p.muted })}
                >
                  {p.muted ? <Mic size={15} /> : <MicOff size={15} />}
                </IconButton>
              )}
              {can(p, 'member.kick') && (
                <IconButton label={`Remove ${p.name} from the room`} className="h-8 w-8" onClick={() => setPending({ kind: 'kick', who: p })}>
                  <UserMinus size={15} />
                </IconButton>
              )}
            </div>
          </li>
        ))}
      </ul>
      {selfRole === 'host' && <p className="mt-3 text-xs text-ink-soft">As host you can add co-hosts, hand over the role, mute or remove someone.</p>}
      {selfRole === 'co_host' && <p className="mt-3 text-xs text-ink-soft">As a co-host you can mute members{settings.coHostsCanKick ? ' or remove them' : ''}.</p>}
      {pending && (
        <ConfirmDialog
          open
          title={CONFIRM[pending.kind].title}
          confirmLabel={CONFIRM[pending.kind].label}
          destructive={CONFIRM[pending.kind].destructive}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const { kind, who } = pending;
            if (kind === 'promote') controller.transport.send({ type: 'role:set', to: who.id, role: 'co_host' });
            else if (kind === 'demote') controller.transport.send({ type: 'role:set', to: who.id, role: 'member' });
            else if (kind === 'transfer') controller.transport.send({ type: 'host:transfer', to: who.id });
            else controller.transport.send({ type: 'host:kick', id: who.id });
            setPending(null);
          }}
        >
          {CONFIRM[pending.kind].text(pending.who.name)}
        </ConfirmDialog>
      )}
    </div>
  );
}
