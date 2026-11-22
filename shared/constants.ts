// Shared limits, alphabets and lists. Pure TS, no DOM or Node APIs.

export const THEME_IDS = ['strawberry', 'lavender', 'cloud', 'vanilla', 'starlight', 'bubblegum'] as const;
export const AVATAR_IDS = [
  'cat', 'bunny', 'bear', 'panda', 'fox', 'frog', 'chick', 'unicorn', 'octopus', 'penguin', 'hamster', 'koala',
] as const;

export const AVATAR_EMOJI: Record<(typeof AVATAR_IDS)[number], string> = {
  cat: '🐱', bunny: '🐰', bear: '🐻', panda: '🐼', fox: '🦊', frog: '🐸',
  chick: '🐥', unicorn: '🦄', octopus: '🐙', penguin: '🐧', hamster: '🐹', koala: '🐨',
};

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export const LIMITS = {
  displayNameMax: 24,
  roomNameMax: 40,
  passwordMin: 4,
  passwordMax: 64,
  titleMax: 120,
  chatMax: 500,
  fileNameMax: 255,
  refMax: 32,
  idMax: 64,
  linkIdMax: 32,
  maxPositionSec: 86400,
  maxFileSize: 2 ** 40,
  sdpMax: 32 * 1024,
  candidateMax: 2048,
  candidateFieldMax: 256,
  maxFrameBytes: 65536,
  chatHistory: 100,
  queueMax: 50,
  queuePerUser: 10,
  suggestionsMax: 30,
  suggestionsPerUser: 5,
} as const;

/** Wire role values with their display names. */
export const ROLES = { HOST: 'host', CO_HOST: 'co_host', MEMBER: 'member' } as const;

/** Emoji allowed in eaction:send. */
export const REACTION_EMOJI = ['??', '??', '??', '??', '??', '??'] as const;

export const DEFAULTS = {
  maxParticipants: 8,
  maxRooms: 300,
  maxConnectionsPerIp: 20,
  reconnectGraceMs: 30_000,
  hostGraceMs: 10_000,
  emptyRoomTtlMs: 60_000,
  maxRoomAgeMs: 12 * 60 * 60 * 1000,
  sweepIntervalMs: 1000,
  turnSkipMs: 15_000,
  idleMs: 30_000,
  unjoinedMaxMs: 600_000,
  pingIntervalMs: 20_000,
  pongTimeoutMs: 45_000,
  port: 8787,
} as const;

export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const LINK_ID_RE = /^[A-Za-z0-9_-]+$/;
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export const SESSION_STORAGE_KEY = 'moonie-session';
export const THEME_STORAGE_KEY = 'moonie-theme';
export const IDENTITY_STORAGE_KEY = 'moonie-identity';

export const CLOSE_IDLE = 1008;
export const CLOSE_REPLACED = 4000;
export const CLOSE_KICKED = 4001;
