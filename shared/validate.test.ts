import { describe, expect, it } from 'vitest';
import { parseClientMessage, parseGameAction, parseLocalFileMeta, sanitizeChat, sanitizeName } from './validate';

const profile = { displayName: 'Mochi', avatar: 'cat' };
const parse = (m: unknown) => parseClientMessage(m);
const isOk = (m: unknown) => parse(m).ok;
const meta = { name: 'movie.mp4', size: 1000, lastModified: 5, mime: 'video/mp4' };

describe('frame and type', () => {
  it('rejects non-objects and unknown types', () => {
    for (const v of [null, 5, 'x', [], undefined]) expect(isOk(v)).toBe(false);
    expect(isOk({ type: 'nope' })).toBe(false);
    expect(isOk({})).toBe(false);
  });
  it('keeps a valid ref and drops an invalid one', () => {
    const a = parse({ type: 'room:peek', code: 'ABCD23', ref: 'r1' });
    expect(a.ok && a.msg.ref).toBe('r1');
    const b = parse({ type: 'room:peek', code: 'ABCD23', ref: 'x'.repeat(33) });
    expect(b.ok && b.msg.ref).toBeUndefined();
  });
});

describe('names and profile', () => {
  it('sanitizes control and bidi chars and trims', () => {
    expect(sanitizeName('  Mo\u0000o\u202enie  ', 24)).toBe('Moonie');
    expect(sanitizeName('\u200b\u200b', 24)).toBeNull();
    expect(sanitizeName('a'.repeat(25), 24)).toBeNull();
    expect(sanitizeName('😀'.repeat(24), 24)).not.toBeNull();
    expect(sanitizeName(5, 24)).toBeNull();
  });
  it('validates room:create', () => {
    const base = { type: 'room:create', name: 'Movie night', theme: 'cloud', ...profile };
    expect(isOk(base)).toBe(true);
    expect(isOk({ ...base, theme: 'neon' })).toBe(false);
    expect(isOk({ ...base, avatar: 'dog' })).toBe(false);
    expect(isOk({ ...base, name: '' })).toBe(false);
    expect(isOk({ ...base, name: 'x'.repeat(41) })).toBe(false);
    expect(isOk({ ...base, displayName: 'x'.repeat(25) })).toBe(false);
    expect(isOk({ ...base, password: 'abc' })).toBe(false);
    expect(isOk({ ...base, password: 'abcd' })).toBe(true);
    expect(isOk({ ...base, password: 'x'.repeat(65) })).toBe(false);
  });
});

describe('room codes', () => {
  it('normalizes codes on peek and join', () => {
    const r = parse({ type: 'room:join', code: 'abc-d23', ...profile });
    expect(r.ok && r.msg.type === 'room:join' && r.msg.code).toBe('ABCD23');
    expect(isOk({ type: 'room:peek', code: 'zzzzz' })).toBe(false);
    expect(isOk({ type: 'room:join', code: 'ABCD23', ...profile, resumeToken: '' })).toBe(false);
    expect(isOk({ type: 'room:join', code: 'ABCD23', ...profile, resumeToken: 'tok' })).toBe(true);
  });
});

describe('media, playback and queue', () => {
  it('validates video ids and titles', () => {
    expect(isOk({ type: 'queue:add', videoId: 'dQw4w9WgXcQ' })).toBe(true);
    expect(isOk({ type: 'queue:add', videoId: 'short' })).toBe(false);
    expect(isOk({ type: 'queue:add', videoId: 'dQw4w9WgXcQ!' })).toBe(false);
    const t = parse({ type: 'queue:add', videoId: 'dQw4w9WgXcQ', title: 'x'.repeat(200) });
    expect(t.ok && t.msg.type === 'queue:add' && Array.from(t.msg.title ?? '').length).toBe(120);
  });
  it('validates media:set', () => {
    expect(isOk({ type: 'media:set', media: null })).toBe(true);
    expect(isOk({ type: 'media:set', media: { kind: 'youtube', videoId: 'dQw4w9WgXcQ' } })).toBe(true);
    expect(isOk({ type: 'media:set', media: { kind: 'local', file: meta, delivery: 'same-file' } })).toBe(true);
    expect(isOk({ type: 'media:set', media: { kind: 'local', file: meta, delivery: 'stream' } })).toBe(false);
    expect(isOk({ type: 'media:set', media: { kind: 'screen' } })).toBe(false);
  });
  it('validates positionSec and rev', () => {
    const base = { type: 'playback:command', rev: 1, action: 'seek', positionSec: 10 };
    expect(isOk(base)).toBe(true);
    expect(isOk({ ...base, positionSec: -1 })).toBe(false);
    expect(isOk({ ...base, positionSec: 86401 })).toBe(false);
    expect(isOk({ ...base, positionSec: NaN })).toBe(false);
    expect(isOk({ ...base, rev: 1.5 })).toBe(false);
    expect(isOk({ ...base, action: 'stop' })).toBe(false);
  });
  it('validates queue reorder, media errors, ready and ping', () => {
    expect(isOk({ type: 'queue:reorder', itemId: 'a', toIndex: 99 })).toBe(true);
    expect(isOk({ type: 'queue:reorder', itemId: 'a', toIndex: 1.5 })).toBe(false);
    expect(isOk({ type: 'media:error', rev: 1, code: 150 })).toBe(true);
    expect(isOk({ type: 'media:error', rev: 1, code: 70000 })).toBe(false);
    expect(isOk({ type: 'local:ready', rev: 1, ready: 'yes' })).toBe(false);
    expect(isOk({ type: 'sync:ping', t0: Infinity })).toBe(false);
    expect(isOk({ type: 'sync:ping', t0: 123 })).toBe(true);
  });
});

describe('LocalFileMeta', () => {
  it('applies the rules', () => {
    expect(parseLocalFileMeta(meta)).not.toBeNull();
    expect(parseLocalFileMeta({ ...meta, mime: 'audio/mp3' })).toBeNull();
    expect(parseLocalFileMeta({ ...meta, size: 0 })).toBeNull();
    expect(parseLocalFileMeta({ ...meta, size: 2 ** 41 })).toBeNull();
    expect(parseLocalFileMeta({ ...meta, lastModified: -1 })).toBeNull();
    expect(parseLocalFileMeta({ ...meta, name: '' })).toBeNull();
    expect(parseLocalFileMeta({ ...meta, durationSec: 90000 })).toBeNull();
    expect(parseLocalFileMeta({ ...meta, hash: 'abc' })).toBeNull();
    expect(parseLocalFileMeta({ ...meta, hash: 'a'.repeat(64) })).not.toBeNull();
  });
  it('validates share:start', () => {
    expect(isOk({ type: 'share:start', source: 'screen', hasAudio: true })).toBe(true);
    expect(isOk({ type: 'share:start', source: 'screen', hasAudio: true, file: meta })).toBe(false);
    expect(isOk({ type: 'share:start', source: 'file', hasAudio: true })).toBe(false);
    expect(isOk({ type: 'share:start', source: 'file', hasAudio: false, file: meta })).toBe(true);
    expect(isOk({ type: 'share:start', source: 'camera', hasAudio: false })).toBe(false);
    expect(isOk({ type: 'share:start', source: 'screen', hasAudio: 'yes' })).toBe(false);
  });
});

describe('chat', () => {
  it('trims, collapses newlines, truncates, rejects empty', () => {
    expect(sanitizeChat('  hi\nthere\u0007  ')).toBe('hi there');
    expect(sanitizeChat('   ')).toBeNull();
    expect(Array.from(sanitizeChat('a'.repeat(900)) ?? '').length).toBe(500);
    expect(isOk({ type: 'chat:send', text: '' })).toBe(false);
    expect(isOk({ type: 'chat:typing', typing: 'yes' })).toBe(false);
  });
});

describe('rtc:signal', () => {
  const base = { type: 'rtc:signal', to: 'b', sessionId: 's', linkId: 'link_1', data: { t: 'viewer-ready' } };
  it('accepts valid signals', () => {
    expect(isOk(base)).toBe(true);
    expect(isOk({ ...base, data: { t: 'description', description: { type: 'offer', sdp: 'v=0' } } })).toBe(true);
    expect(isOk({ ...base, data: { t: 'candidate', candidate: null } })).toBe(true);
  });
  it('drops bad linkIds silently', () => {
    for (const linkId of ['', 'x'.repeat(33), 'bad id!', 5]) {
      const r = parse({ ...base, linkId });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.silent).toBe(true);
    }
  });
  it('drops oversize candidates and flags oversize SDP', () => {
    const cand = (c: object) => ({ ...base, data: { t: 'candidate', candidate: { candidate: 'a', ...c } } });
    expect(isOk(cand({ candidate: 'x'.repeat(2049) }))).toBe(false);
    expect(isOk(cand({ candidate: 'x'.repeat(2048) }))).toBe(true);
    expect(isOk(cand({ sdpMid: 'x'.repeat(257) }))).toBe(false);
    expect(isOk(cand({ usernameFragment: 'x'.repeat(257) }))).toBe(false);
    expect(isOk(cand({ sdpMLineIndex: 256 }))).toBe(false);
    expect(isOk(cand({ sdpMLineIndex: 1.5 }))).toBe(false);
    expect(isOk(cand({ sdpMLineIndex: null }))).toBe(true);
    const big = parse({ ...base, data: { t: 'description', description: { type: 'offer', sdp: 'x'.repeat(40 * 1024) } } });
    expect(!big.ok && big.warn).toBe('oversize_sdp');
    const ok20 = { ...base, data: { t: 'description', description: { type: 'offer', sdp: 'x'.repeat(20 * 1024) } } };
    expect(isOk(ok20)).toBe(true);
    expect(isOk({ ...base, data: { t: 'unknown' } })).toBe(false);
  });
});

describe('misc rows', () => {
  it('validates profile:update, room:settings, game messages, host messages', () => {
    expect(isOk({ type: 'profile:update' })).toBe(false);
    expect(isOk({ type: 'profile:update', avatar: 'fox' })).toBe(true);
    expect(isOk({ type: 'room:settings' })).toBe(false);
    expect(isOk({ type: 'room:settings', password: null })).toBe(true);
    expect(isOk({ type: 'room:settings', password: 'ab' })).toBe(false);
    expect(isOk({ type: 'game:open', kind: 'chess' })).toBe(false);
    expect(isOk({ type: 'game:open', kind: 'ludo' })).toBe(true);
    expect(isOk({ type: 'game:action', action: null })).toBe(false);
    expect(isOk({ type: 'host:kick', id: '' })).toBe(false);
    expect(isOk({ type: 'host:transfer', to: 'x'.repeat(65) })).toBe(false);
  });
  it('parseGameAction rejects everything until the games phase', () => {
    for (const v of [null, [], 'x', { type: 'sit', color: 'red' }, { type: 'skipTurn' }]) {
      expect(parseGameAction('ludo', v)).toBeNull();
    }
  });
});
