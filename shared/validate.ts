import { AVATAR_IDS, LIMITS, LINK_ID_RE, SHA256_HEX_RE, THEME_IDS, VIDEO_ID_RE } from './constants';
import type { GameAction, GameKind } from './games/types';
import type { AvatarId, ClientMessage, ErrorCode, LocalFileMeta, RtcSignalData, ThemeId } from './protocol';
import { normalizeCode } from './roomCode';

// ---------------------------------------------------------------------------
// Sanitizers (reused by the client)
// ---------------------------------------------------------------------------

const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;
const FORMAT_RE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

export function codePointLength(s: string): number {
  return Array.from(s).length;
}

function truncateCodePoints(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join('');
}

/** NFC, strip control and bidi/zero-width characters, trim. Does not enforce length. */
export function cleanText(s: string): string {
  return s.normalize('NFC').replace(CONTROL_RE, '').replace(FORMAT_RE, '').trim();
}

/** Sanitizes a name. Returns null when empty after cleaning or longer than `max` code points. */
export function sanitizeName(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const s = cleanText(raw);
  const len = codePointLength(s);
  return len >= 1 && len <= max ? s : null;
}

export function sanitizeTitle(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = truncateCodePoints(cleanText(raw), LIMITS.titleMax);
  return s || undefined;
}

/** Chat: newlines and tabs become spaces, control chars removed, truncated to 500. Null when empty. */
export function sanitizeChat(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = truncateCodePoints(cleanText(raw.replace(/[\r\n\t]+/g, ' ')), LIMITS.chatMax);
  return s.length ? s : null;
}

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v);
}

export function isAvatarId(v: unknown): v is AvatarId {
  return typeof v === 'string' && (AVATAR_IDS as readonly string[]).includes(v);
}

export function validPassword(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const len = codePointLength(raw);
  return len >= LIMITS.passwordMin && len <= LIMITS.passwordMax ? raw : null;
}

export function validVideoId(raw: unknown): string | null {
  return typeof raw === 'string' && VIDEO_ID_RE.test(raw) ? raw : null;
}

export function parseLocalFileMeta(raw: unknown): LocalFileMeta | null {
  if (!isObject(raw)) return null;
  const name = sanitizeName(raw.name, LIMITS.fileNameMax);
  if (!name) return null;
  const { size, lastModified, mime, durationSec, hash } = raw;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > LIMITS.maxFileSize) return null;
  if (typeof lastModified !== 'number' || !Number.isFinite(lastModified) || lastModified < 0) return null;
  if (typeof mime !== 'string' || mime.length > 100 || !/^video\/[A-Za-z0-9.+_-]+$/.test(mime)) return null;
  const meta: LocalFileMeta = { name, size, lastModified, mime };
  if (durationSec !== undefined) {
    if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec < 0 || durationSec > 86400) {
      return null;
    }
    meta.durationSec = durationSec;
  }
  if (hash !== undefined) {
    if (typeof hash !== 'string' || !SHA256_HEX_RE.test(hash)) return null;
    meta.hash = hash;
  }
  return meta;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// rtc:signal
// ---------------------------------------------------------------------------

export type SignalCheck = { ok: true; data: RtcSignalData } | { ok: false; reason: 'oversize_sdp' | 'invalid' };

export function parseRtcSignalData(raw: unknown): SignalCheck {
  if (!isObject(raw)) return { ok: false, reason: 'invalid' };
  if (raw.t === 'viewer-ready') {
    const reason = raw.reason;
    if (reason !== undefined && reason !== 'initial' && reason !== 'retry') return { ok: false, reason: 'invalid' };
    return { ok: true, data: reason ? { t: 'viewer-ready', reason } : { t: 'viewer-ready' } };
  }
  if (raw.t === 'description') {
    const d = raw.description;
    if (!isObject(d) || (d.type !== 'offer' && d.type !== 'answer') || typeof d.sdp !== 'string') {
      return { ok: false, reason: 'invalid' };
    }
    if (d.sdp.length > LIMITS.sdpMax) return { ok: false, reason: 'oversize_sdp' };
    return { ok: true, data: { t: 'description', description: { type: d.type, sdp: d.sdp } } };
  }
  if (raw.t === 'candidate') {
    if (raw.candidate === null) return { ok: true, data: { t: 'candidate', candidate: null } };
    const c = raw.candidate;
    if (!isObject(c) || typeof c.candidate !== 'string' || c.candidate.length > LIMITS.candidateMax) {
      return { ok: false, reason: 'invalid' };
    }
    const out: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null } =
      { candidate: c.candidate };
    for (const key of ['sdpMid', 'usernameFragment'] as const) {
      const v = c[key];
      if (v === undefined) continue;
      if (v !== null && (typeof v !== 'string' || v.length > LIMITS.candidateFieldMax)) {
        return { ok: false, reason: 'invalid' };
      }
      out[key] = v as string | null;
    }
    const idx = c.sdpMLineIndex;
    if (idx !== undefined) {
      if (idx !== null && (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx > 255)) {
        return { ok: false, reason: 'invalid' };
      }
      out.sdpMLineIndex = idx as number | null;
    }
    return { ok: true, data: { t: 'candidate', candidate: out } };
  }
  return { ok: false, reason: 'invalid' };
}

// ---------------------------------------------------------------------------
// Game actions
// ---------------------------------------------------------------------------

const LUDO_COLORS = ['red', 'green', 'yellow', 'blue'] as const;
const RPS_CHOICES = ['rock', 'paper', 'scissors'] as const;

/**
 * Returns a typed action for the given game kind, or null when the shape is invalid.
 * Extra fields are dropped. Ludo `skipTurn` is server-only and is never accepted here.
 */
export function parseGameAction(kind: GameKind, raw: unknown): GameAction | null {
  if (!isObject(raw)) return null;
  const type = raw.type;
  if (kind === 'ludo') {
    switch (type) {
      case 'leaveSeat':
      case 'start':
      case 'roll':
      case 'restart':
        return { type };
      case 'sit':
        return LUDO_COLORS.includes(raw.color as (typeof LUDO_COLORS)[number])
          ? { type, color: raw.color as (typeof LUDO_COLORS)[number] }
          : null;
      case 'move':
        return typeof raw.piece === 'number' && Number.isInteger(raw.piece) && raw.piece >= 0 && raw.piece <= 3
          ? { type, piece: raw.piece }
          : null;
      default:
        return null;
    }
  }
  if (kind === 'tictactoe') {
    switch (type) {
      case 'leaveSeat':
      case 'restart':
        return { type };
      case 'sit':
        return raw.mark === 'X' || raw.mark === 'O' ? { type, mark: raw.mark } : null;
      case 'move':
        return typeof raw.index === 'number' && Number.isInteger(raw.index) && raw.index >= 0 && raw.index <= 8
          ? { type, index: raw.index }
          : null;
      default:
        return null;
    }
  }
  switch (type) {
    case 'join':
    case 'leave':
    case 'start':
    case 'next':
    case 'resetScores':
      return { type };
    case 'pick':
      return RPS_CHOICES.includes(raw.choice as (typeof RPS_CHOICES)[number])
        ? { type, choice: raw.choice as (typeof RPS_CHOICES)[number] }
        : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Client message parsing
// ---------------------------------------------------------------------------

export type ParseResult =
  | { ok: true; msg: ClientMessage }
  | { ok: false; code: ErrorCode; message: string; ref?: string; silent?: boolean; warn?: string };

const bad = (message: string, ref?: string): ParseResult => ({ ok: false, code: 'bad_request', message, ref });

function validId(v: unknown): string | null {
  return typeof v === 'string' && v.length >= 1 && v.length <= LIMITS.idMax ? v : null;
}

/** Parses a decoded JSON value into a validated ClientMessage. */
export function parseClientMessage(raw: unknown): ParseResult {
  if (!isObject(raw)) return bad('Message must be an object');
  let ref: string | undefined;
  if (typeof raw.ref === 'string' && raw.ref.length >= 1 && raw.ref.length <= LIMITS.refMax) ref = raw.ref;
  const withRef = <T extends object>(m: T) => (ref ? { ...m, ref } : m) as unknown as ClientMessage;
  const ok = (m: object): ParseResult => ({ ok: true, msg: withRef(m) });
  const fail = (message: string) => bad(message, ref);
  const type = raw.type;
  if (typeof type !== 'string') return fail('Missing message type');

  const profile = () => {
    const displayName = sanitizeName(raw.displayName, LIMITS.displayNameMax);
    if (!displayName) return null;
    if (!isAvatarId(raw.avatar)) return null;
    return { displayName, avatar: raw.avatar };
  };

  switch (type) {
    case 'room:create': {
      const p = profile();
      const name = sanitizeName(raw.name, LIMITS.roomNameMax);
      if (!p || !name || !isThemeId(raw.theme)) return fail('Invalid room details');
      const msg: Record<string, unknown> = { type, name, theme: raw.theme, ...p };
      if (raw.password !== undefined && raw.password !== null && raw.password !== '') {
        const pw = validPassword(raw.password);
        if (!pw) return fail('Password must be 4 to 64 characters');
        msg.password = pw;
      }
      return ok(msg);
    }
    case 'room:peek': {
      const code = typeof raw.code === 'string' ? normalizeCode(raw.code) : null;
      return code ? ok({ type, code }) : fail('Invalid room code');
    }
    case 'room:join': {
      const code = typeof raw.code === 'string' ? normalizeCode(raw.code) : null;
      const p = profile();
      if (!code || !p) return fail('Invalid join details');
      const msg: Record<string, unknown> = { type, code, ...p };
      if (raw.resumeToken !== undefined) {
        const token = validId(raw.resumeToken);
        if (!token) return fail('Invalid resume token');
        msg.resumeToken = token;
      }
      if (raw.password !== undefined && raw.password !== null && raw.password !== '') {
        if (typeof raw.password !== 'string' || codePointLength(raw.password) > LIMITS.passwordMax) {
          return fail('Invalid password');
        }
        msg.password = raw.password;
      }
      return ok(msg);
    }
    case 'room:leave':
    case 'share:stop':
    case 'game:close':
      return ok({ type });
    case 'profile:update': {
      const msg: Record<string, unknown> = { type };
      if (raw.displayName !== undefined) {
        const n = sanitizeName(raw.displayName, LIMITS.displayNameMax);
        if (!n) return fail('Invalid display name');
        msg.displayName = n;
      }
      if (raw.avatar !== undefined) {
        if (!isAvatarId(raw.avatar)) return fail('Invalid avatar');
        msg.avatar = raw.avatar;
      }
      return msg.displayName === undefined && msg.avatar === undefined ? fail('Nothing to update') : ok(msg);
    }
    case 'room:settings': {
      const msg: Record<string, unknown> = { type };
      if (raw.name !== undefined) {
        const n = sanitizeName(raw.name, LIMITS.roomNameMax);
        if (!n) return fail('Invalid room name');
        msg.name = n;
      }
      if (raw.theme !== undefined) {
        if (!isThemeId(raw.theme)) return fail('Invalid theme');
        msg.theme = raw.theme;
      }
      if (raw.password !== undefined) {
        if (raw.password === null) msg.password = null;
        else {
          const pw = validPassword(raw.password);
          if (!pw) return fail('Password must be 4 to 64 characters');
          msg.password = pw;
        }
      }
      return Object.keys(msg).length === 1 ? fail('Nothing to update') : ok(msg);
    }
    case 'host:transfer': {
      const to = validId(raw.to);
      return to ? ok({ type, to }) : fail('Invalid participant id');
    }
    case 'host:kick': {
      const id = validId(raw.id);
      return id ? ok({ type, id }) : fail('Invalid participant id');
    }
    case 'sync:ping':
      return typeof raw.t0 === 'number' && Number.isFinite(raw.t0) ? ok({ type, t0: raw.t0 }) : fail('Invalid t0');
    case 'media:set': {
      if (raw.media === null) return ok({ type, media: null });
      const m = raw.media;
      if (!isObject(m)) return fail('Invalid media');
      if (m.kind === 'youtube') {
        const videoId = validVideoId(m.videoId);
        if (!videoId) return fail('Invalid video id');
        const title = sanitizeTitle(m.title);
        return ok({ type, media: title ? { kind: 'youtube', videoId, title } : { kind: 'youtube', videoId } });
      }
      if (m.kind === 'local') {
        const file = parseLocalFileMeta(m.file);
        if (!file || m.delivery !== 'same-file') return fail('Invalid local media');
        return ok({ type, media: { kind: 'local', file, delivery: 'same-file' } });
      }
      return fail('Invalid media kind');
    }
    case 'playback:command': {
      const { rev, action, positionSec, hostServerTime } = raw;
      if (typeof rev !== 'number' || !Number.isInteger(rev)) return fail('Invalid rev');
      if (action !== 'play' && action !== 'pause' && action !== 'seek') return fail('Invalid action');
      if (typeof positionSec !== 'number' || !Number.isFinite(positionSec) || positionSec < 0 || positionSec > LIMITS.maxPositionSec) {
        return fail('Invalid position');
      }
      const msg: Record<string, unknown> = { type, rev, action, positionSec };
      if (typeof hostServerTime === 'number' && Number.isFinite(hostServerTime)) msg.hostServerTime = hostServerTime;
      return ok(msg);
    }
    case 'local:ready': {
      if (typeof raw.rev !== 'number' || !Number.isInteger(raw.rev) || typeof raw.ready !== 'boolean') {
        return fail('Invalid local:ready');
      }
      return ok({ type, rev: raw.rev, ready: raw.ready });
    }
    case 'media:ended': {
      return typeof raw.rev === 'number' && Number.isInteger(raw.rev) ? ok({ type, rev: raw.rev }) : fail('Invalid rev');
    }
    case 'media:error': {
      const { rev, code } = raw;
      if (typeof rev !== 'number' || !Number.isInteger(rev)) return fail('Invalid rev');
      if (typeof code !== 'number' || !Number.isInteger(code) || code < 0 || code > 65535) return fail('Invalid code');
      return ok({ type, rev, code });
    }
    case 'queue:add': {
      const videoId = validVideoId(raw.videoId);
      if (!videoId) return fail('Invalid video id');
      const title = sanitizeTitle(raw.title);
      return ok(title ? { type, videoId, title } : { type, videoId });
    }
    case 'queue:remove':
    case 'queue:play': {
      const itemId = validId(raw.itemId);
      return itemId ? ok({ type, itemId }) : fail('Invalid item id');
    }
    case 'queue:reorder': {
      const itemId = validId(raw.itemId);
      if (!itemId || typeof raw.toIndex !== 'number' || !Number.isInteger(raw.toIndex)) return fail('Invalid reorder');
      return ok({ type, itemId, toIndex: raw.toIndex });
    }
    case 'share:start': {
      const { source, hasAudio, file } = raw;
      if (source !== 'screen' && source !== 'file') return fail('Invalid source');
      if (typeof hasAudio !== 'boolean') return fail('Invalid hasAudio');
      if (source === 'screen') {
        return file === undefined ? ok({ type, source, hasAudio }) : fail('File is not allowed for screen share');
      }
      const meta = parseLocalFileMeta(file);
      return meta ? ok({ type, source, hasAudio, file: meta }) : fail('Invalid file meta');
    }
    case 'rtc:signal': {
      const to = validId(raw.to);
      const sessionId = validId(raw.sessionId);
      const linkId = typeof raw.linkId === 'string' && raw.linkId.length <= LIMITS.linkIdMax && LINK_ID_RE.test(raw.linkId)
        ? raw.linkId
        : null;
      if (!to || !sessionId || !linkId) return { ok: false, code: 'bad_request', message: 'Invalid signal', silent: true };
      const data = parseRtcSignalData(raw.data);
      if (!data.ok) {
        return {
          ok: false,
          code: 'bad_request',
          message: 'Invalid signal',
          silent: true,
          warn: data.reason === 'oversize_sdp' ? 'oversize_sdp' : undefined,
        };
      }
      return ok({ type, to, sessionId, linkId, data: data.data });
    }
    case 'chat:send': {
      const text = sanitizeChat(raw.text);
      return text ? ok({ type, text }) : fail('Message is empty');
    }
    case 'chat:typing':
      return typeof raw.typing === 'boolean' ? ok({ type, typing: raw.typing }) : fail('Invalid typing flag');
    case 'game:open': {
      return raw.kind === 'ludo' || raw.kind === 'tictactoe' || raw.kind === 'rps'
        ? ok({ type, kind: raw.kind })
        : fail('Invalid game kind');
    }
    case 'game:action':
      // Shape is checked later by parseGameAction(room.game.kind, action).
      return isObject(raw.action) ? ok({ type, action: raw.action }) : fail('Invalid game action');
    default:
      return fail('Unknown message type');
  }
}
