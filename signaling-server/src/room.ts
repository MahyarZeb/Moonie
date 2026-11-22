import { randomBytes, randomUUID } from 'node:crypto';
import { LIMITS } from '../../shared/constants';
import { expectedPosition } from '../../shared/playback';
import type {
  AvatarId,
  ChatMessage,
  ErrorCode,
  MediaState,
  Participant,
  PlaybackState,
  QueueItem,
  RoomPeek,
  RoomSnapshot,
  ServerMessage,
  ThemeId,
} from '../../shared/protocol';
import type { GameView } from '../../shared/games/types';
import type { Logger } from './log';
import type { PasswordHash } from './password';

export interface Clock {
  now(): number;
}

export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface RoomOptions {
  maxParticipants: number;
  reconnectGraceMs: number;
  hostGraceMs: number;
  emptyRoomTtlMs: number;
  maxRoomAgeMs: number;
}

export interface ServerParticipant {
  participant: Participant;
  socket: SocketLike | null;
  resumeToken: string;
  disconnectedAt?: number;
  typing: boolean;
}

export type Fail = { ok: false; code: ErrorCode; message: string };
export const fail = (code: ErrorCode, message: string): Fail => ({ ok: false, code, message });

export interface ShareSession {
  sessionId: string;
  sharerId: string;
}

export interface Profile {
  displayName: string;
  avatar: AvatarId;
}

const newId = () => randomUUID().replace(/-/g, '').slice(0, 12);

/**
 * One room. Plain TypeScript with an injected clock and logger so it can be tested without sockets.
 * Sockets are reached only through `SocketLike`.
 */
export class Room {
  readonly code: string;
  name: string;
  theme: ThemeId;
  passwordHash: PasswordHash | null = null;
  hostId = '';
  readonly participants = new Map<string, ServerParticipant>();
  media: MediaState | null = null;
  playback: PlaybackState;
  queue: QueueItem[] = [];
  game: GameView | null = null;
  chat: ChatMessage[] = [];
  mediaRev = 0;
  shareSession: ShareSession | null = null;
  readonly createdAt: number;
  lastActiveAt: number;
  emptySince: number | null = null;

  constructor(
    code: string,
    name: string,
    theme: ThemeId,
    private readonly clock: Clock,
    private readonly opts: RoomOptions,
    private readonly log: Logger,
  ) {
    this.code = code;
    this.name = name;
    this.theme = theme;
    this.createdAt = clock.now();
    this.lastActiveAt = this.createdAt;
    this.playback = { rev: 0, status: 'paused', positionSec: 0, updatedAt: this.createdAt };
  }

  // ------------------------------------------------------------------ views

  get hasPassword(): boolean {
    return this.passwordHash !== null;
  }

  isFull(): boolean {
    return this.participants.size >= this.opts.maxParticipants;
  }

  connectedCount(): number {
    let n = 0;
    for (const p of this.participants.values()) if (p.participant.connected) n++;
    return n;
  }

  peek(): RoomPeek {
    const peek: RoomPeek = {
      code: this.code,
      name: this.name,
      theme: this.theme,
      hasPassword: this.hasPassword,
      count: this.connectedCount(),
      max: this.opts.maxParticipants,
      hostName: this.participants.get(this.hostId)?.participant.name ?? 'Someone',
    };
    if (!this.hasPassword) {
      peek.participants = [...this.participants.values()]
        .filter((p) => p.participant.connected)
        .map((p) => ({ name: p.participant.name, avatar: p.participant.avatar }));
    }
    return peek;
  }

  snapshot(viewerId?: string): RoomSnapshot {
    void viewerId;
    return {
      code: this.code,
      name: this.name,
      theme: this.theme,
      hasPassword: this.hasPassword,
      hostId: this.hostId,
      createdAt: this.createdAt,
      maxParticipants: this.opts.maxParticipants,
      participants: [...this.participants.values()].map((p) => ({ ...p.participant })),
      media: this.media,
      playback: this.playback,
      queue: this.queue,
      game: this.game,
      chat: this.chat.slice(-LIMITS.chatHistory),
      serverTime: this.clock.now(),
    };
  }

  // -------------------------------------------------------------- messaging

  sendTo(id: string, msg: ServerMessage): void {
    const sp = this.participants.get(id);
    if (!sp?.socket) return;
    try {
      sp.socket.send(JSON.stringify(msg));
    } catch (err) {
      this.log.debug('send failed', { room: this.code, error: String(err) });
    }
  }

  broadcast(msg: ServerMessage, exceptId?: string): void {
    for (const id of this.participants.keys()) if (id !== exceptId) this.sendTo(id, msg);
  }

  sendError(id: string, code: ErrorCode, message: string, ref?: string): void {
    this.sendTo(id, ref ? { type: 'error', code, message, ref } : { type: 'error', code, message });
  }

  addSystemChat(text: string): void {
    const message: ChatMessage = { id: randomUUID(), kind: 'system', text, ts: this.clock.now() };
    this.chat.push(message);
    if (this.chat.length > LIMITS.chatHistory) this.chat.splice(0, this.chat.length - LIMITS.chatHistory);
    this.broadcast({ type: 'chat:message', message });
  }

  touch(): void {
    this.lastActiveAt = this.clock.now();
  }

  // ------------------------------------------------------------ membership

  /** Adds a participant. The first participant, or any joiner when the host is gone, becomes host. */
  join(profile: Profile, socket: SocketLike, ref?: string): { id: string; resumeToken: string } {
    const now = this.clock.now();
    const id = newId();
    const resumeToken = randomBytes(24).toString('base64url');
    const participant: Participant = {
      id,
      name: profile.displayName,
      avatar: profile.avatar,
      joinedAt: now,
      connected: true,
    };
    this.participants.set(id, { participant, socket, resumeToken, typing: false });
    this.emptySince = null;
    const becameHost = !this.participants.has(this.hostId) || this.hostId === '';
    if (becameHost) this.hostId = id;
    this.sendTo(id, {
      type: 'room:joined',
      selfId: id,
      resumeToken,
      snapshot: this.snapshot(id),
      resumed: false,
      ...(ref ? { ref } : {}),
    });
    this.broadcast({ type: 'participant:joined', participant: { ...participant } }, id);
    this.addSystemChat(`${participant.name} joined 🌙`);
    return { id, resumeToken };
  }

  findByToken(token: string): ServerParticipant | undefined {
    for (const sp of this.participants.values()) if (sp.resumeToken === token) return sp;
    return undefined;
  }

  /** Resume with a valid token. The previous socket (if any) is closed with 4000. */
  resume(sp: ServerParticipant, socket: SocketLike, replacedCode: number, ref?: string): void {
    const old = sp.socket;
    sp.socket = socket;
    sp.participant.connected = true;
    sp.disconnectedAt = undefined;
    this.emptySince = null;
    if (old && old !== socket) {
      try {
        old.close(replacedCode, 'replaced');
      } catch {
        /* already closed */
      }
    }
    if (!this.participants.has(this.hostId)) {
      this.hostId = sp.participant.id;
      this.broadcast({ type: 'host:changed', hostId: this.hostId, reason: 'timeout' }, sp.participant.id);
    }
    this.sendTo(sp.participant.id, {
      type: 'room:joined',
      selfId: sp.participant.id,
      resumeToken: sp.resumeToken,
      snapshot: this.snapshot(sp.participant.id),
      resumed: true,
      ...(ref ? { ref } : {}),
    });
    this.broadcast({ type: 'participant:updated', participant: { ...sp.participant } }, sp.participant.id);
  }

  /** Called when a socket closes. Ignored when the participant already has a newer socket. */
  disconnect(id: string, socket: SocketLike): void {
    const sp = this.participants.get(id);
    if (!sp || sp.socket !== socket) return;
    sp.socket = null;
    sp.typing = false;
    sp.participant.connected = false;
    sp.disconnectedAt = this.clock.now();
    if (this.shareSession?.sharerId === id) this.endShare();
    this.broadcast({ type: 'participant:updated', participant: { ...sp.participant } });
  }

  /** Removes a participant (explicit leave, grace timeout or kick) and migrates the host if needed. */
  removeParticipant(id: string, reason: 'left' | 'timeout' | 'kicked'): void {
    const sp = this.participants.get(id);
    if (!sp) return;
    const wasHost = id === this.hostId;
    if (this.shareSession?.sharerId === id) this.endShare();
    this.participants.delete(id);
    this.broadcast({ type: 'participant:left', id, reason });
    this.addSystemChat(reason === 'kicked' ? `${sp.participant.name} was removed 🚪` : `${sp.participant.name} left 👋`);
    if (wasHost) this.migrateHost(reason === 'timeout' ? 'timeout' : 'left');
    if (this.participants.size === 0) this.emptySince = this.clock.now();
  }

  /** Moves host to the connected participant with the lowest joinedAt. */
  migrateHost(reason: 'left' | 'transfer' | 'timeout'): boolean {
    const next = [...this.participants.values()]
      .filter((p) => p.participant.connected && p.participant.id !== this.hostId)
      .sort((a, b) => a.participant.joinedAt - b.participant.joinedAt)[0];
    if (!next) return false;
    this.freezePlayback();
    this.endShare();
    this.hostId = next.participant.id;
    this.broadcast({ type: 'host:changed', hostId: this.hostId, reason });
    return true;
  }

  /** Pauses a playing youtube/local playback at its extrapolated position and tells everyone. */
  private freezePlayback(): void {
    const m = this.media;
    if ((m?.kind !== 'youtube' && m?.kind !== 'local') || this.playback.status !== 'playing') return;
    const now = this.clock.now();
    this.playback = {
      rev: m.rev,
      status: 'paused',
      positionSec: expectedPosition(this.playback, now, m.kind === 'local' ? m.file.durationSec : undefined),
      updatedAt: now,
    };
    this.broadcast({ type: 'playback:state', playback: this.playback });
  }

  /**
   * Single teardown path for screen shares and file streams.
   * Screen: media becomes null. Local stream: falls back to the same file in same-file mode, paused.
   */
  endShare(): void {
    if (!this.shareSession) return;
    const now = this.clock.now();
    const prev = this.media;
    this.shareSession = null;
    this.mediaRev += 1;
    if (prev?.kind === 'local' && prev.delivery === 'stream') {
      this.media = { kind: 'local', rev: this.mediaRev, file: prev.file, delivery: 'same-file' };
      this.playback = {
        rev: this.mediaRev,
        status: 'paused',
        positionSec: expectedPosition(this.playback, now, prev.file.durationSec),
        updatedAt: now,
      };
    } else {
      this.media = null;
      this.playback = { rev: this.mediaRev, status: 'paused', positionSec: 0, updatedAt: now };
    }
    this.broadcast({ type: 'media:state', media: this.media, playback: this.playback, queue: this.queue });
  }

  // --------------------------------------------------------------- actions

  transferHost(actorId: string, to: string): Fail | { ok: true } {
    if (actorId !== this.hostId) return fail('not_host', 'Only the host can do that');
    if (to === actorId) return fail('invalid_state', 'You are already the host');
    const target = this.participants.get(to);
    if (!target) return fail('not_found', 'Participant not found');
    if (!target.participant.connected) return fail('invalid_state', 'That participant is not connected');
    this.endShare();
    this.hostId = to;
    this.broadcast({ type: 'host:changed', hostId: to, reason: 'transfer' });
    return { ok: true };
  }

  kick(actorId: string, targetId: string): Fail | { ok: true } {
    if (actorId !== this.hostId) return fail('not_host', 'Only the host can do that');
    if (targetId === actorId) return fail('invalid_state', 'You cannot remove yourself');
    const target = this.participants.get(targetId);
    if (!target) return fail('not_found', 'Participant not found');
    const socket = target.socket;
    if (socket) {
      try {
        socket.send(JSON.stringify({ type: 'kicked' } satisfies ServerMessage));
      } catch {
        /* ignore */
      }
    }
    target.resumeToken = ''; // revoke
    target.socket = null; // the kicked socket gets no further broadcasts
    this.removeParticipant(targetId, 'kicked');
    try {
      socket?.close(4001, 'kicked');
    } catch {
      /* ignore */
    }
    return { ok: true };
  }

  updateProfile(id: string, patch: { displayName?: string; avatar?: AvatarId }): void {
    const sp = this.participants.get(id);
    if (!sp) return;
    if (patch.displayName) sp.participant.name = patch.displayName;
    if (patch.avatar) sp.participant.avatar = patch.avatar;
    this.broadcast({ type: 'participant:updated', participant: { ...sp.participant } });
  }

  applySettings(
    actorId: string,
    patch: { name?: string; theme?: ThemeId },
    password: PasswordHash | null | undefined,
  ): Fail | { ok: true } {
    if (actorId !== this.hostId) return fail('not_host', 'Only the host can do that');
    if (patch.name) this.name = patch.name;
    if (patch.theme) this.theme = patch.theme;
    if (password !== undefined) this.passwordHash = password;
    this.broadcast({ type: 'room:settings', name: this.name, theme: this.theme, hasPassword: this.hasPassword });
    return { ok: true };
  }

  // ------------------------------------------------------------- lifecycle

  /** Handles deadlines. Returns true when the registry should delete the room. */
  sweep(): boolean {
    const now = this.clock.now();
    if (now - this.createdAt >= this.opts.maxRoomAgeMs) {
      this.closeAll('expired');
      return true;
    }
    for (const [id, sp] of [...this.participants]) {
      if (sp.disconnectedAt !== undefined && now - sp.disconnectedAt >= this.opts.reconnectGraceMs) {
        this.removeParticipant(id, 'timeout');
      }
    }
    const host = this.participants.get(this.hostId);
    if (host && host.disconnectedAt !== undefined && now - host.disconnectedAt >= this.opts.hostGraceMs) {
      this.migrateHost('timeout');
    }
    return this.participants.size === 0 && this.emptySince !== null && now - this.emptySince >= this.opts.emptyRoomTtlMs;
  }

  closeAll(reason: 'expired' | 'empty'): void {
    this.broadcast({ type: 'room:closed', reason });
    for (const sp of this.participants.values()) {
      try {
        sp.socket?.close(1000, reason);
      } catch {
        /* ignore */
      }
      sp.socket = null;
    }
    this.participants.clear();
  }
}
