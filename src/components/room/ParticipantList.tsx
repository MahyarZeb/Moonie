'use client';

import { useSyncExternalStore } from 'react';
import { Crown, UserMinus, UserCog } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/IconButton';
import { useRoom, useRoomController } from '@/lib/room/RoomProvider';

const NO_LINKS: Record<string, RTCPeerConnectionState> = {};

function describeLink(state: RTCPeerConnectionState): string {
  if (state === 'connected') return 'Watching your screen';
  if (state === 'failed') return "Couldn't connect";
  if (state === 'disconnected') return 'Connection hiccup…';
  return 'Connecting…';
}

export function ParticipantList() {
  const controller = useRoomController();
  const snapshot = useRoom((s) => s.snapshot);
  const selfId = useRoom((s) => s.selfId);
  const share = controller.share;
  const links = useSyncExternalStore(share.subscribe, () => share.getState().links, () => NO_LINKS);
  if (!snapshot) return null;
  const isHost = snapshot.hostId === selfId;
  const sharerId = snapshot.media?.kind === 'screen' ? snapshot.media.sharerId : null;
  const connected = snapshot.participants.filter((p) => p.connected).length;

  return (
    <div>
      <p className="mb-3 text-sm font-bold text-ink-soft" aria-live="polite">
        {connected} online{snapshot.participants.length > connected ? ` · ${snapshot.participants.length - connected} reconnecting` : ''}
      </p>
      <ul className="space-y-2">
        {snapshot.participants.map((p) => (
          <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2">
            <Avatar avatar={p.avatar} dim={!p.connected} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-bold">{p.name}</span>
                {p.id === selfId && <span className="text-xs font-semibold text-ink-soft">(you)</span>}
                {p.id === snapshot.hostId && (
                  <Badge tone="pink">
                    <Crown size={11} aria-hidden /> Host
                  </Badge>
                )}
              </div>
              {!p.connected && <span className="text-xs text-ink-soft">Reconnecting…</span>}
              {p.connected && p.id === sharerId && <span className="text-xs text-ink-soft">Sharing their screen</span>}
              {p.connected && p.id !== selfId && links[p.id] && (
                <span className="text-xs text-ink-soft">{describeLink(links[p.id]!)}</span>
              )}
            </div>
            {isHost && p.id !== selfId && (
              <div className="flex gap-1">
                <IconButton
                  label={`Make ${p.name} the host`}
                  className="h-8 w-8"
                  disabled={!p.connected}
                  onClick={() => controller.transport.send({ type: 'host:transfer', to: p.id })}
                >
                  <UserCog size={15} />
                </IconButton>
                <IconButton label={`Remove ${p.name}`} className="h-8 w-8" onClick={() => controller.transport.send({ type: 'host:kick', id: p.id })}>
                  <UserMinus size={15} />
                </IconButton>
              </div>
            )}
          </li>
        ))}
      </ul>
      {isHost && <p className="mt-3 text-xs text-ink-soft">As host you can hand over the role or remove someone.</p>}
    </div>
  );
}
