import { randomBytes, randomUUID } from 'node:crypto';
import { LIMITS } from '../../shared/constants';
import { DEFAULT_SETTINGS, can, canActOn, type Action } from '../../shared/permissions';
import { applyCommand, expectedPosition } from '../../shared/playback';
import * as queueRules from '../../shared/queue';
import type {
  AvatarId,
  ChatMessage,
  ClientMessage,
  ErrorCode,
  LocalFileMeta,
  MediaState,
  Participant,
  PlaybackState,
  QueueItem,
  Role,
  RoomPeek,
  RoomSettings,
  RoomSnapshot,
  ServerMessage,
  ThemeId,
} from '../../shared/protocol';
import { createGame, ludo, reduceGame, removeGamePlayer, seatedIds, viewGame, type GameState } from '../../shared/games';
import type { Actor, GameKind } from '../../shared/games/types';
import { parseGameAction } from '../../shared/validate';
import type { Logger } from './log';
import { nullMetadata, type MetadataResolver } from './metadata';
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
  /** A Ludo turn owner who has been disconnected this long loses the turn. */
  turnSkipMs: number;
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

/** Media that `media:set` and the queue can create. Screen shares and file streams come from `share:start`. */
type NewMedia =
  | { kind: 'youtube'; videoId: string; title?: string; startedBy: string }
  | { kind: 'local'; file: LocalFileMeta; delivery: 'same-file' };

export type SetMediaInput = Extract<ClientMessage, { type: 'media:set' }>['media'];

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
  settings: RoomSettings = { ...DEFAULT_SETTINGS };
  readonly participants = new Map<string, ServerParticipant>();
  media: MediaState | null = null;
  playback: PlaybackState;
  queue: QueueItem[] = [];
  /** Member videos waiting for approval. */
  suggestions: QueueItem[] = [];
  /** Authoritative game state. Clients only ever see gameView(id), which redacts hidden information. */
  gameState: GameState | null = null;
  /** Float source for dice. Defaults to a CSPRNG; tests can replace it. */
  rng: () => number = () => randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
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
    private readonly metadata: MetadataResolver = nullMetadata,
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
    return {
      code: this.code,
      name: this.name,
      theme: this.theme,
      hasPassword: this.hasPassword,
      hostId: this.hostId,
      settings: { ...this.settings },
      createdAt: this.createdAt,
      maxParticipants: this.opts.maxParticipants,
      participants: [...this.participants.values()].map((p) => ({ ...p.participant })),
      media: this.media,
      playback: this.playback,
      queue: this.queue,
      suggestions: this.suggestions,
      game: this.gameState ? viewGame(this.gameState, viewerId ?? '') : null,
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

  /** Appends a user message (text already sanitized) and broadcasts it to everyone, sender included. */
  addChat(fromId: string, text: string): void {
    const sp = this.participants.get(fromId);
    if (!sp) return;
    const message: ChatMessage = {
      id: randomUUID(),
      kind: 'user',
      from: fromId,
      name: sp.participant.name,
      avatar: sp.participant.avatar,
      text,
      ts: this.clock.now(),
    };
    this.chat.push(message);
    if (this.chat.length > LIMITS.chatHistory) this.chat.splice(0, this.chat.length - LIMITS.chatHistory);
    sp.typing = false;
    this.broadcast({ type: 'chat:message', message });
  }

  /** Relays a typing flag to everyone except the typist. */
  setTyping(id: string, typing: boolean): void {
    const sp = this.participants.get(id);
    if (!sp || sp.typing === typing) return;
    sp.typing = typing;
    this.broadcast({ type: 'chat:typing', id, typing }, id);
  }

  /** The server-held role of a participant. Roles never come from client messages. */
  roleOf(id: string): Role | undefined {
    return this.participants.get(id)?.participant.role;
  }

  /** Permission check for the actor. False for ids that are not in the room. */
  allowed(actorId: string, action: Action): boolean {
    const role = this.roleOf(actorId);
    return role !== undefined && can(role, action, this.settings);
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
      role: 'member',
    };
    this.participants.set(id, { participant, socket, resumeToken, typing: false });
    this.emptySince = null;
    const becameHost = !this.participants.has(this.hostId) || this.hostId === '';
    if (becameHost) {
      participant.role = 'host';
      this.hostId = id;
    }
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
      sp.participant.role = 'host';
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
    if (sp.typing) {
      sp.typing = false;
      this.broadcast({ type: 'chat:typing', id, typing: false }, id);
    }
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
    this.dropFromGame(id);
    this.broadcast({ type: 'participant:left', id, reason });
    this.addSystemChat(reason === 'kicked' ? `${sp.participant.name} was removed 🚪` : `${sp.participant.name} left 👋`);
    if (wasHost) this.migrateHost(reason === 'timeout' ? 'timeout' : 'left');
    if (this.participants.size === 0) this.emptySince = this.clock.now();
  }

  /**
   * Successor rule: the longest-connected co-host, else the longest-connected member.
   * Only connected participants other than the current host qualify.
   */
  pickSuccessor(): ServerParticipant | undefined {
    return [...this.participants.values()]
      .filter((p) => p.participant.connected && p.participant.id !== this.hostId)
      .sort((a, b) => {
        const rank = (r: Role) => (r === 'co_host' ? 0 : 1);
        return rank(a.participant.role) - rank(b.participant.role) || a.participant.joinedAt - b.participant.joinedAt;
      })[0];
  }

  /** Moves host to the successor (see `pickSuccessor`). A former host who still has a record becomes co-host. */
  migrateHost(reason: 'left' | 'transfer' | 'timeout'): boolean {
    const next = this.pickSuccessor();
    if (!next) return false;
    this.freezePlayback();
    this.assignHost(next.participant.id, reason);
    return true;
  }

  /**
   * The only place the host changes. Keeps the invariant that exactly one participant has the host role
   * and that it is `hostId`. The previous host, if it still has a record, becomes co-host.
   */
  private assignHost(id: string, reason: 'left' | 'transfer' | 'timeout'): void {
    const next = this.participants.get(id);
    if (!next) return;
    const prev = this.participants.get(this.hostId);
    if (prev && prev !== next) prev.participant.role = 'co_host';
    next.participant.role = 'host';
    this.hostId = id;
    this.endShareIfUncontrolled();
    this.broadcast({ type: 'host:changed', hostId: id, reason });
    if (prev && prev !== next) this.broadcast({ type: 'participant:updated', participant: { ...prev.participant } });
    this.broadcast({ type: 'participant:updated', participant: { ...next.participant } });
  }

  /** Ends the share when its owner can no longer start shares (demoted or gone). */
  private endShareIfUncontrolled(): void {
    const s = this.shareSession;
    if (!s) return;
    const sharer = this.participants.get(s.sharerId);
    if (!sharer || !can(sharer.participant.role, 'media.share.start', this.settings)) this.endShare();
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
    if (!this.allowed(actorId, 'host.transfer')) return fail('not_host', 'Only the host can do that');
    if (to === actorId) return fail('invalid_state', 'You are already the host');
    const target = this.participants.get(to);
    if (!target) return fail('not_found', 'Participant not found');
    if (!target.participant.connected) return fail('invalid_state', 'That participant is not connected');
    this.assignHost(to, 'transfer');
    return { ok: true };
  }

  /** Host-only: promote a member to co-host or demote a co-host to member. The host role moves only by transfer. */
  setRole(actorId: string, targetId: string, role: 'co_host' | 'member'): Fail | { ok: true } {
    const actor = this.roleOf(actorId);
    if (actor === undefined || !can(actor, 'room.roles', this.settings)) return fail('not_host', 'Only the host can change roles');
    const target = this.participants.get(targetId);
    if (!target) return fail('not_found', 'Participant not found');
    if (targetId === actorId) return fail('invalid_state', 'You are the host');
    if (!canActOn(actor, target.participant.role, 'room.roles', this.settings, false)) {
      return fail('forbidden', 'You cannot change that role');
    }
    if (target.participant.role === role) return { ok: true };
    target.participant.role = role;
    if (role !== 'member') delete target.participant.muted;
    this.endShareIfUncontrolled();
    this.broadcast({ type: 'participant:updated', participant: { ...target.participant } });
    return { ok: true };
  }

  kick(actorId: string, targetId: string): Fail | { ok: true } {
    const actor = this.roleOf(actorId);
    if (actor === undefined || !can(actor, 'member.kick', this.settings)) return fail('not_host', 'Only the host can do that');
    if (targetId === actorId) return fail('invalid_state', 'You cannot remove yourself');
    const target = this.participants.get(targetId);
    if (!target) return fail('not_found', 'Participant not found');
    if (!canActOn(actor, target.participant.role, 'member.kick', this.settings)) {
      return fail('forbidden', 'You cannot remove that person');
    }
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
    patch: { name?: string; theme?: ThemeId } & Partial<RoomSettings>,
    password: PasswordHash | null | undefined,
  ): Fail | { ok: true } {
    if (!this.allowed(actorId, 'room.settings')) return fail('not_host', 'Only the host can do that');
    if (patch.name) this.name = patch.name;
    if (patch.theme) this.theme = patch.theme;
    if (patch.requireApproval !== undefined) this.settings.requireApproval = patch.requireApproval;
    if (patch.autoNext !== undefined) this.settings.autoNext = patch.autoNext;
    if (patch.coHostsCanKick !== undefined) this.settings.coHostsCanKick = patch.coHostsCanKick;
    if (password !== undefined) this.passwordHash = password;
    this.broadcast({
      type: 'room:settings',
      name: this.name,
      theme: this.theme,
      hasPassword: this.hasPassword,
      settings: { ...this.settings },
    });
    return { ok: true };
  }

  // ----------------------------------------------------------- media, queue

  /** Sends `media:state` to everyone. The requester's copy carries its `ref`. */
  private publishMedia(requesterId?: string, ref?: string): void {
    const msg: ServerMessage = { type: 'media:state', media: this.media, playback: this.playback, queue: this.queue };
    for (const id of this.participants.keys()) {
      this.sendTo(id, ref && id === requesterId ? { ...msg, ref } : msg);
    }
  }

  private publishPlayback(requesterId?: string, ref?: string): void {
    const msg: ServerMessage = { type: 'playback:state', playback: this.playback };
    for (const id of this.participants.keys()) {
      this.sendTo(id, ref && id === requesterId ? { ...msg, ref } : msg);
    }
  }

  private publishQueue(requesterId?: string, ref?: string): void {
    const msg: ServerMessage = { type: 'queue:updated', queue: this.queue };
    for (const id of this.participants.keys()) {
      this.sendTo(id, ref && id === requesterId ? { ...msg, ref } : msg);
    }
  }

  /** Replies to the requester only (a successful request that changed nothing). */
  private replyMedia(id: string, ref?: string): void {
    this.sendTo(id, { type: 'media:state', media: this.media, playback: this.playback, queue: this.queue, ...(ref ? { ref } : {}) });
  }

  private replyQueue(id: string, ref?: string): void {
    this.sendTo(id, { type: 'queue:updated', queue: this.queue, ...(ref ? { ref } : {}) });
  }

  /**
   * Replaces the current media (never a screen/stream; those come from `share:start`).
   * Ends any share first, bumps `mediaRev`, sets the initial playback and resets `hasFile`
   * when the file identity changes. Does not broadcast.
   */
  private applyMedia(next: NewMedia | null): void {
    if (this.shareSession) this.endShare();
    const prev = this.media;
    const now = this.clock.now();
    this.mediaRev += 1;
    this.media = next ? { ...next, rev: this.mediaRev } : null;
    this.playback = {
      rev: this.mediaRev,
      status: next?.kind === 'youtube' ? 'playing' : 'paused',
      positionSec: 0,
      updatedAt: now,
    };
    this.resetHasFile(prev, next?.kind === 'local' ? next.file : null);
  }

  /** Clears every `hasFile` flag unless the new media is the same local file as the previous one. */
  private resetHasFile(prev: MediaState | null, nextFile: LocalFileMeta | null): void {
    const sameFile =
      prev?.kind === 'local' &&
      nextFile !== null &&
      prev.file.name === nextFile.name &&
      prev.file.size === nextFile.size &&
      prev.file.lastModified === nextFile.lastModified;
    if (sameFile) return;
    for (const sp of this.participants.values()) {
      if (!sp.participant.hasFile) continue;
      sp.participant.hasFile = false;
      this.broadcast({ type: 'participant:updated', participant: { ...sp.participant } });
    }
  }

  /** `share:start` from the host. Screen shares replace any media; file streams convert the same-file media in place. */
  startShare(
    actorId: string,
    msg: { source: 'screen' | 'file'; hasAudio: boolean; file?: LocalFileMeta },
    ref?: string,
  ): Fail | { ok: true } {
    if (!this.allowed(actorId, 'media.share.start')) return fail('not_host', 'Only the host or a co-host can share');
    if (this.shareSession) return fail('invalid_state', 'Someone is already sharing');
    const prev = this.media;
    const now = this.clock.now();
    const sessionId = newId();
    if (msg.source === 'screen') {
      this.mediaRev += 1;
      this.media = { kind: 'screen', rev: this.mediaRev, sharerId: actorId, sessionId, hasAudio: msg.hasAudio };
      this.playback = { rev: this.mediaRev, status: 'paused', positionSec: 0, updatedAt: now };
      this.resetHasFile(prev, null);
    } else {
      const f = msg.file;
      if (
        prev?.kind !== 'local' ||
        prev.delivery !== 'same-file' ||
        !f ||
        f.name !== prev.file.name ||
        f.size !== prev.file.size ||
        f.lastModified !== prev.file.lastModified
      ) {
        return fail('invalid_state', 'Pick that file for the room before streaming it');
      }
      this.mediaRev += 1;
      this.media = {
        kind: 'local',
        rev: this.mediaRev,
        file: prev.file,
        delivery: 'stream',
        sharerId: actorId,
        sessionId,
        hasAudio: msg.hasAudio,
      };
      this.playback = { ...this.playback, rev: this.mediaRev };
    }
    this.shareSession = { sessionId, sharerId: actorId };
    this.publishMedia(actorId, ref);
    return { ok: true };
  }

  /**
   * `local:ready` from any participant. Accepted only for the current same-file media and revision.
   * Anything else is ignored without a reply (the client re-sends on the next revision), and a repeat
   * of the stored value is a no-op without a broadcast.
   */
  localReady(actorId: string, rev: number, ready: boolean): void {
    const m = this.media;
    if (m?.kind !== 'local' || m.delivery !== 'same-file' || m.rev !== rev) return;
    const sp = this.participants.get(actorId);
    if (!sp || (sp.participant.hasFile ?? false) === ready) return;
    sp.participant.hasFile = ready;
    this.broadcast({ type: 'participant:updated', participant: { ...sp.participant } });
  }

  stopShare(actorId: string): Fail | { ok: true } {
    if (!this.allowed(actorId, 'media.share.stop')) return fail('not_host', 'Only the host or a co-host can stop sharing');
    this.endShare();
    return { ok: true };
  }

  /**
   * Relays one WebRTC signal to its target. Only sharer<->viewer traffic inside the active session is
   * forwarded; everything else is dropped silently. The server never reads `linkId`.
   */
  relaySignal(fromId: string, msg: Extract<ClientMessage, { type: 'rtc:signal' }>): boolean {
    const share = this.shareSession;
    if (!share || msg.sessionId !== share.sessionId || msg.to === fromId) return false;
    if (fromId !== share.sharerId && msg.to !== share.sharerId) return false;
    const target = this.participants.get(msg.to);
    if (!target?.socket || !target.participant.connected) return false;
    this.sendTo(msg.to, { type: 'rtc:signal', from: fromId, sessionId: msg.sessionId, linkId: msg.linkId, data: msg.data });
    return true;
  }

  private startYouTube(videoId: string, title: string | undefined, startedBy: string): void {
    this.applyMedia({ kind: 'youtube', videoId, ...(title ? { title } : {}), startedBy });
    this.fetchTitle(videoId);
  }

  setMedia(actorId: string, media: SetMediaInput, ref?: string): Fail | { ok: true } {
    if (!this.allowed(actorId, 'media.set')) return fail('not_host', 'Only the host or a co-host can change what is playing');
    const cur = this.media;
    const same =
      media === null
        ? cur === null
        : media.kind === 'youtube'
          ? cur?.kind === 'youtube' && cur.videoId === media.videoId
          : cur?.kind === 'local' &&
            cur.delivery === 'same-file' &&
            cur.file.name === media.file.name &&
            cur.file.size === media.file.size &&
            cur.file.lastModified === media.file.lastModified;
    if (same) {
      this.replyMedia(actorId, ref);
      return { ok: true };
    }
    if (media === null) this.applyMedia(null);
    else if (media.kind === 'youtube') this.startYouTube(media.videoId, media.title, actorId);
    else this.applyMedia({ kind: 'local', file: media.file, delivery: 'same-file' });
    this.publishMedia(actorId, ref);
    return { ok: true };
  }

  playbackCommand(
    actorId: string,
    cmd: { rev: number; action: 'play' | 'pause' | 'seek'; positionSec: number; hostServerTime?: number },
    ref?: string,
  ): Fail | { ok: true } {
    if (!this.allowed(actorId, 'playback.control')) return fail('not_host', 'Only the host or a co-host can control playback');
    const m = this.media;
    if (m?.kind !== 'youtube' && m?.kind !== 'local') return fail('invalid_state', 'Nothing is playing');
    if (cmd.rev !== m.rev) return fail('stale', 'That command was for an earlier video');
    this.playback = applyCommand(this.playback, cmd, this.clock.now(), actorId);
    this.publishPlayback(actorId, ref);
    return { ok: true };
  }

  /** `media:ended` and `media:error` from the host: play the next queue item or pause at the end. */
  mediaFinished(actorId: string, rev: number, failed: boolean): Fail | { ok: true } {
    if (!this.allowed(actorId, 'playback.control')) return fail('not_host', 'Only the host or a co-host can do that');
    const m = this.media;
    if (m?.kind !== 'youtube' && m?.kind !== 'local') return fail('invalid_state', 'Nothing is playing');
    if (rev !== m.rev) return fail('stale', 'That was for an earlier video');
    if (failed) this.addSystemChat("Skipped a video that couldn't be played 🙈");
    // With autoNext off, or an empty queue, nothing starts and playback pauses at the end.
    const res = queueRules.finish(this.queueState(), this.settings);
    if (res.effects.length > 0) {
      this.commitQueue(res.state, res.effects);
      return { ok: true };
    }
    const now = this.clock.now();
    this.playback = {
      rev: m.rev,
      status: 'paused',
      positionSec: m.kind === 'local' && m.file.durationSec !== undefined
        ? m.file.durationSec
        : expectedPosition(this.playback, now),
      updatedAt: now,
    };
    this.publishPlayback();
    return { ok: true };
  }

  private queueState(): queueRules.QueueState {
    return { queue: this.queue, suggestions: this.suggestions };
  }

  private queueContext(actorId: string): queueRules.QueueContext | null {
    const role = this.roleOf(actorId);
    if (role === undefined) return null;
    const m = this.media;
    return {
      actorId,
      role,
      settings: this.settings,
      currentVideoId: m?.kind === 'youtube' ? m.videoId : null,
      idle: m === null,
      now: this.clock.now(),
      newId,
    };
  }

  /** Looks up a title on the metadata resolver and applies it when it lands. Never blocks or throws. */
  private fetchTitle(videoId: string): void {
    this.metadata
      .resolveTitle(videoId)
      .then((title) => {
        if (title) this.applyResolvedTitle(videoId, title);
      })
      .catch(() => undefined);
  }

  private applyResolvedTitle(videoId: string, title: string): void {
    const cur = this.queueState();
    const next = queueRules.applyTitle(cur, videoId, title);
    if (next !== cur) {
      const queueChanged = next.queue !== cur.queue;
      const suggestionsChanged = next.suggestions !== cur.suggestions;
      this.queue = next.queue;
      this.suggestions = next.suggestions;
      if (queueChanged) this.publishQueue();
      if (suggestionsChanged) this.publishSuggestions();
    }
    const m = this.media;
    if (m?.kind === 'youtube' && m.videoId === videoId && m.title !== title) {
      this.media = { ...m, title };
      this.publishMedia();
    }
  }

  private publishSuggestions(requesterId?: string, ref?: string): void {
    const msg: ServerMessage = { type: 'suggestions:updated', suggestions: this.suggestions };
    for (const id of this.participants.keys()) {
      this.sendTo(id, ref && id === requesterId ? { ...msg, ref } : msg);
    }
  }

  /**
   * Applies a successful queue result: stores the new lists, runs start/stop effects, publishes what changed
   * and sends notices. Exactly one message to the requester carries `ref`.
   */
  private commitQueue(next: queueRules.QueueState, effects: queueRules.QueueEffect[], actorId?: string, ref?: string): void {
    const queueChanged = next.queue !== this.queue;
    const suggestionsChanged = next.suggestions !== this.suggestions;
    this.queue = next.queue;
    this.suggestions = next.suggestions;
    let mediaChanged = false;
    for (const e of effects) {
      if (e.type === 'start') {
        this.startYouTube(e.item.videoId, e.item.title, e.item.addedBy);
        mediaChanged = true;
      } else if (e.type === 'stop') {
        this.applyMedia(null);
        mediaChanged = true;
      }
    }
    let refUsed = false;
    const refFor = (): string | undefined => {
      if (refUsed) return undefined;
      refUsed = true;
      return ref;
    };
    if (mediaChanged) this.publishMedia(actorId, refFor());
    else if (queueChanged) this.publishQueue(actorId, refFor());
    if (suggestionsChanged) this.publishSuggestions(actorId, refFor());
    if (!refUsed && ref && actorId) this.replyQueue(actorId, ref);
    for (const e of effects) if (e.type === 'notice') this.sendNotice(actorId, e.kind, e.item);
  }

  private sendNotice(actorId: string | undefined, kind: 'added' | 'suggested', item: QueueItem): void {
    const by = this.participants.get(item.addedBy)?.participant.name ?? 'Someone';
    const msg: ServerMessage = { type: 'queue:notice', kind, itemId: item.id, videoId: item.videoId, ...(item.title ? { title: item.title } : {}), by };
    for (const [id, sp] of this.participants) {
      if (id === actorId) continue;
      if (kind === 'suggested' && !can(sp.participant.role, 'queue.manage', this.settings)) continue;
      this.sendTo(id, msg);
    }
  }

  private runQueue(
    actorId: string,
    ref: string | undefined,
    rule: (state: queueRules.QueueState, ctx: queueRules.QueueContext) => queueRules.QueueResult,
  ): Fail | { ok: true } {
    const ctx = this.queueContext(actorId);
    if (!ctx) return fail('not_found', 'Participant not found');
    const res = rule(this.queueState(), ctx);
    if (!res.ok) return res;
    this.commitQueue(res.state, res.effects, actorId, ref);
    return { ok: true };
  }

  /**
   * `queue:add`. Member adds become suggestions (approval on) or queue entries (approval off) and never
   * start playback. Host and co-host adds go to the queue, and start playing when the room is idle.
   * The client title is a hint; the server resolves the real title afterwards.
   */
  queueAdd(actorId: string, videoId: string, title: string | undefined, ref?: string): Fail | { ok: true } {
    const res = this.runQueue(actorId, ref, (s, c) => queueRules.addVideo(s, c, videoId, title));
    if (res.ok) this.fetchTitle(videoId);
    return res;
  }

  queueApprove(actorId: string, itemId: string, position: 'end' | 'next' | undefined, ref?: string): Fail | { ok: true } {
    return this.runQueue(actorId, ref, (s, c) => queueRules.approve(s, c, itemId, position));
  }

  /** Removes a queue item or rejects/withdraws a suggestion. */
  queueRemove(actorId: string, itemId: string, ref?: string): Fail | { ok: true } {
    return this.runQueue(actorId, ref, (s, c) => queueRules.removeItem(s, c, itemId));
  }

  queueReorder(actorId: string, itemId: string, toIndex: number, ref?: string): Fail | { ok: true } {
    return this.runQueue(actorId, ref, (s, c) => queueRules.reorder(s, c, itemId, toIndex));
  }

  queuePlay(actorId: string, itemId: string, ref?: string): Fail | { ok: true } {
    return this.runQueue(actorId, ref, (s, c) => queueRules.playItem(s, c, itemId));
  }

  /** Plays the next queued video, or ends playback when the queue is empty. */
  queueSkip(actorId: string, ref?: string): Fail | { ok: true } {
    if (this.allowed(actorId, 'queue.manage') && this.queue.length === 0 && this.shareSession) {
      return fail('invalid_state', 'Stop sharing first');
    }
    return this.runQueue(actorId, ref, (s, c) => queueRules.skip(s, c));
  }

  // ------------------------------------------------- chat moderation, reactions

  /** `chat:send`. Muted participants are refused. */
  sendChat(actorId: string, text: string): Fail | { ok: true } {
    const sp = this.participants.get(actorId);
    if (!sp) return fail('not_found', 'Participant not found');
    if (sp.participant.muted) return fail('forbidden', 'You are muted');
    this.addChat(actorId, text);
    return { ok: true };
  }

  /** Deletes a user chat message for everyone and from the history late joiners receive. */
  deleteChat(actorId: string, messageId: string): Fail | { ok: true } {
    const actor = this.roleOf(actorId);
    if (actor === undefined || !can(actor, 'chat.moderate', this.settings)) {
      return fail('not_host', 'Only the host or a co-host can moderate chat');
    }
    const idx = this.chat.findIndex((m) => m.id === messageId);
    if (idx < 0) return fail('not_found', 'That message is gone');
    const msg = this.chat[idx]!;
    if (msg.kind !== 'user') return fail('invalid_state', 'Only chat messages can be deleted');
    const authorRole = (msg.from ? this.roleOf(msg.from) : undefined) ?? 'member';
    if (msg.from !== actorId && !canActOn(actor, authorRole, 'chat.moderate', this.settings)) {
      return fail('forbidden', 'You cannot delete that message');
    }
    this.chat.splice(idx, 1);
    this.broadcast({ type: 'chat:deleted', id: messageId });
    return { ok: true };
  }

  /** Mutes or unmutes a participant's chat. A co-host can only act on members. */
  muteChat(actorId: string, targetId: string, muted: boolean): Fail | { ok: true } {
    const actor = this.roleOf(actorId);
    if (actor === undefined || !can(actor, 'chat.moderate', this.settings)) {
      return fail('not_host', 'Only the host or a co-host can moderate chat');
    }
    if (targetId === actorId) return fail('invalid_state', 'You cannot mute yourself');
    const target = this.participants.get(targetId);
    if (!target) return fail('not_found', 'Participant not found');
    if (!canActOn(actor, target.participant.role, 'chat.moderate', this.settings)) {
      return fail('forbidden', 'You cannot mute that person');
    }
    if ((target.participant.muted ?? false) === muted) return { ok: true };
    if (muted) target.participant.muted = true;
    else delete target.participant.muted;
    if (muted && target.typing) this.setTyping(targetId, false);
    this.broadcast({ type: 'participant:updated', participant: { ...target.participant } });
    return { ok: true };
  }

  /** Relays an emoji reaction to everyone, sender included. Not stored. Muted participants may react. */
  react(actorId: string, emoji: string): Fail | { ok: true } {
    if (!this.participants.has(actorId)) return fail('not_found', 'Participant not found');
    this.broadcast({ type: 'reaction', from: actorId, emoji });
    return { ok: true };
  }

  // ------------------------------------------------------------------ games

  /** Sends every participant their own redacted view of the current game (or null). */
  private publishGame(): void {
    for (const id of this.participants.keys()) {
      this.sendTo(id, { type: 'game:state', game: this.gameState ? viewGame(this.gameState, id) : null });
    }
  }

  private actorFor(id: string): Actor | null {
    const sp = this.participants.get(id);
    if (!sp) return null;
    return { id, name: sp.participant.name, avatar: sp.participant.avatar, isHost: can(sp.participant.role, 'game.manage', this.settings) };
  }

  openGame(actorId: string, kind: GameKind): Fail | { ok: true } {
    if (!this.allowed(actorId, 'game.manage')) return fail('not_host', 'Only the host or a co-host can open a game');
    if (this.gameState) return fail('invalid_state', 'A game is already open');
    this.gameState = createGame(kind);
    this.publishGame();
    return { ok: true };
  }

  closeGame(actorId: string): Fail | { ok: true } {
    const g = this.gameState;
    if (!g) return fail('invalid_state', 'No game is open');
    if (!this.allowed(actorId, 'game.manage') && !seatedIds(g).includes(actorId)) {
      return fail('forbidden', 'Only a host, a co-host or a seated player can close the game');
    }
    this.gameState = null;
    this.publishGame();
    return { ok: true };
  }

  /** Validates the shape, applies the reducer, and publishes the new state only on success. */
  gameAction(actorId: string, raw: unknown): Fail | { ok: true } {
    const g = this.gameState;
    if (!g) return fail('invalid_state', 'No game is open');
    const action = parseGameAction(g.kind, raw);
    if (!action) return fail('bad_request', 'That is not a valid move for this game');
    const actor = this.actorFor(actorId);
    if (!actor) return fail('not_found', 'Participant not found');
    const res = reduceGame(g, action, actor, this.rng);
    if (!res.ok) return fail(res.code ?? 'invalid_state', res.error);
    this.gameState = res.state;
    this.publishGame();
    return { ok: true };
  }

  /** Removes a departed participant from the game, publishing when anything changed. */
  private dropFromGame(id: string): void {
    const g = this.gameState;
    if (!g) return;
    const next = removeGamePlayer(g, id);
    if (next === g) return;
    this.gameState = next;
    this.publishGame();
  }

  /** Passes a Ludo turn whose owner has been disconnected for `turnSkipMs`. */
  private skipAbsentTurn(now: number): void {
    const g = this.gameState;
    if (g?.kind !== 'ludo') return;
    const owner = ludo.turnOwner(g);
    const sp = owner ? this.participants.get(owner) : undefined;
    if (!owner || !sp || sp.disconnectedAt === undefined || now - sp.disconnectedAt < this.opts.turnSkipMs) return;
    const res = ludo.reduce(g, { type: 'skipTurn' }, { id: owner, name: sp.participant.name, avatar: sp.participant.avatar, isHost: false }, this.rng);
    if (!res.ok) return;
    this.gameState = res.state;
    this.publishGame();
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
    this.skipAbsentTurn(now);
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
