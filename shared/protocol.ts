import type { AVATAR_IDS, THEME_IDS } from './constants';
import type { GameAction, GameKind, GameView } from './games/types';

export type ThemeId = (typeof THEME_IDS)[number];
export type AvatarId = (typeof AVATAR_IDS)[number];

export interface Participant {
  id: string;
  name: string;
  avatar: AvatarId;
  joinedAt: number;
  connected: boolean;
  /** Same-file flow readiness, set by the server from `local:ready`. */
  hasFile?: boolean;
}

export interface LocalFileMeta {
  name: string;
  size: number;
  lastModified: number;
  mime: string;
  durationSec?: number;
  hash?: string;
}

export type MediaState =
  | { kind: 'youtube'; rev: number; videoId: string; title?: string; startedBy: string }
  | { kind: 'screen'; rev: number; sharerId: string; sessionId: string; hasAudio: boolean }
  | {
      kind: 'local';
      rev: number;
      file: LocalFileMeta;
      delivery: 'same-file' | 'stream';
      sharerId?: string;
      sessionId?: string;
      hasAudio?: boolean;
    };

/** `playback.rev` always equals the current `media.rev`. */
export interface PlaybackState {
  rev: number;
  status: 'playing' | 'paused';
  positionSec: number;
  /** Server epoch ms. */
  updatedAt: number;
}

export interface QueueItem {
  id: string;
  videoId: string;
  title?: string;
  addedBy: string;
  addedAt: number;
}

export interface ChatMessage {
  id: string;
  kind: 'user' | 'system';
  from?: string;
  name?: string;
  avatar?: AvatarId;
  text: string;
  ts: number;
}

export interface RoomSnapshot {
  code: string;
  name: string;
  theme: ThemeId;
  hasPassword: boolean;
  hostId: string;
  createdAt: number;
  maxParticipants: number;
  participants: Participant[];
  media: MediaState | null;
  playback: PlaybackState;
  queue: QueueItem[];
  game: GameView | null;
  chat: ChatMessage[];
  serverTime: number;
}

/** `count` is connected participants only. `participants` is omitted for password rooms. */
export interface RoomPeek {
  code: string;
  name: string;
  theme: ThemeId;
  hasPassword: boolean;
  count: number;
  max: number;
  hostName: string;
  participants?: Pick<Participant, 'name' | 'avatar'>[];
}

export type RtcSignalData =
  | { t: 'viewer-ready'; reason?: 'initial' | 'retry' }
  | { t: 'description'; description: { type: 'offer' | 'answer'; sdp: string } }
  | {
      t: 'candidate';
      candidate: {
        candidate: string;
        sdpMid?: string | null;
        sdpMLineIndex?: number | null;
        usernameFragment?: string | null;
      } | null;
    };

export type ClientMessage = { ref?: string } & (
  | { type: 'room:create'; name: string; theme: ThemeId; password?: string; displayName: string; avatar: AvatarId }
  | { type: 'room:peek'; code: string }
  | {
      type: 'room:join';
      code: string;
      password?: string;
      displayName: string;
      avatar: AvatarId;
      resumeToken?: string;
    }
  | { type: 'room:leave' }
  | { type: 'profile:update'; displayName?: string; avatar?: AvatarId }
  | { type: 'room:settings'; name?: string; theme?: ThemeId; password?: string | null }
  | { type: 'host:transfer'; to: string }
  | { type: 'host:kick'; id: string }
  | { type: 'sync:ping'; t0: number }
  | {
      type: 'media:set';
      media:
        | { kind: 'youtube'; videoId: string; title?: string }
        | { kind: 'local'; file: LocalFileMeta; delivery: 'same-file' }
        | null;
    }
  | {
      type: 'playback:command';
      rev: number;
      action: 'play' | 'pause' | 'seek';
      positionSec: number;
      hostServerTime?: number;
    }
  | { type: 'local:ready'; rev: number; ready: boolean }
  | { type: 'media:ended'; rev: number }
  | { type: 'media:error'; rev: number; code: number }
  | { type: 'queue:add'; videoId: string; title?: string }
  | { type: 'queue:remove'; itemId: string }
  | { type: 'queue:reorder'; itemId: string; toIndex: number }
  | { type: 'queue:play'; itemId: string }
  | { type: 'share:start'; source: 'screen' | 'file'; hasAudio: boolean; file?: LocalFileMeta }
  | { type: 'share:stop' }
  | { type: 'rtc:signal'; to: string; sessionId: string; linkId: string; data: RtcSignalData }
  | { type: 'chat:send'; text: string }
  | { type: 'chat:typing'; typing: boolean }
  | { type: 'game:open'; kind: GameKind }
  | { type: 'game:close' }
  | { type: 'game:action'; action: GameAction }
);

export type ErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'wrong_password'
  | 'locked_out'
  | 'room_full'
  | 'rate_limited'
  | 'not_host'
  | 'forbidden'
  | 'invalid_state'
  | 'too_large'
  | 'server_busy'
  | 'stale';

export type ServerMessage =
  | { type: 'room:info'; peek: RoomPeek; ref?: string }
  | { type: 'room:joined'; selfId: string; resumeToken: string; snapshot: RoomSnapshot; resumed: boolean; ref?: string }
  | { type: 'room:closed'; reason: 'expired' | 'empty' }
  | { type: 'kicked' }
  | { type: 'participant:joined'; participant: Participant }
  | { type: 'participant:updated'; participant: Participant }
  | { type: 'participant:left'; id: string; reason: 'left' | 'timeout' | 'kicked' }
  | { type: 'host:changed'; hostId: string; reason: 'left' | 'transfer' | 'timeout' }
  | { type: 'room:settings'; name: string; theme: ThemeId; hasPassword: boolean }
  | { type: 'sync:pong'; t0: number; serverTime: number }
  | { type: 'media:state'; media: MediaState | null; playback: PlaybackState; queue: QueueItem[]; ref?: string }
  | { type: 'playback:state'; playback: PlaybackState; ref?: string }
  | { type: 'queue:updated'; queue: QueueItem[]; ref?: string }
  | { type: 'rtc:signal'; from: string; sessionId: string; linkId: string; data: RtcSignalData }
  | { type: 'chat:message'; message: ChatMessage }
  | { type: 'chat:typing'; id: string; typing: boolean }
  | { type: 'game:state'; game: GameView | null }
  | { type: 'error'; code: ErrorCode; message: string; ref?: string };

export type CreateRoomInput = Omit<Extract<ClientMessage, { type: 'room:create' }>, 'type' | 'ref'>;
export type JoinRoomInput = Omit<Extract<ClientMessage, { type: 'room:join' }>, 'type' | 'ref'>;
export type JoinedPayload = Omit<Extract<ServerMessage, { type: 'room:joined' }>, 'type' | 'ref'>;
