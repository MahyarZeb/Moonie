import { describe, expect, it } from 'vitest';
import { quickHash } from './hash';
import { checkPlayable, formatBytes, inferMime } from './support';
import { verifyLocalFile } from './verify';

describe('verifyLocalFile', () => {
  const host = { name: 'Movie.mp4', size: 100, hash: 'a'.repeat(64) };

  it('matches on equal hash and size', () => {
    expect(verifyLocalFile({ name: 'copy (1).mp4', size: 100, hash: 'a'.repeat(64) }, host)).toBe('match');
  });

  it('mismatches on a different hash even when the name and size agree', () => {
    expect(verifyLocalFile({ name: 'Movie.mp4', size: 100, hash: 'b'.repeat(64) }, host)).toBe('mismatch');
  });

  it('mismatches on a different size', () => {
    expect(verifyLocalFile({ name: 'Movie.mp4', size: 101, hash: 'a'.repeat(64) }, host)).toBe('mismatch');
  });

  it('falls back to name and size when either hash is missing', () => {
    expect(verifyLocalFile({ name: 'Movie.mp4', size: 100 }, host)).toBe('match');
    expect(verifyLocalFile({ name: 'Other.mp4', size: 100 }, host)).toBe('mismatch');
    expect(verifyLocalFile({ name: 'Movie.mp4', size: 100, hash: 'a'.repeat(64) }, { name: 'Movie.mp4', size: 100 })).toBe('match');
  });

  it('ignores case in the name fallback', () => {
    expect(verifyLocalFile({ name: 'MOVIE.MP4', size: 100 }, { name: 'movie.mp4', size: 100 })).toBe('match');
  });
});

describe('checkPlayable', () => {
  const yes = { canPlayType: () => 'maybe' };
  const no = { canPlayType: () => '' };

  it('infers the mime type from the extension when type is empty', () => {
    expect(inferMime('clip.MOV', '')).toBe('video/quicktime');
    expect(inferMime('clip.txt', '')).toBe('');
    expect(inferMime('clip.webm', 'video/webm')).toBe('video/webm');
  });

  it('accepts playable files', () => {
    expect(checkPlayable({ name: 'a.mp4', type: 'video/mp4' }, yes)).toEqual({ ok: true, mime: 'video/mp4' });
  });

  it('explains unsupported containers', () => {
    const res = checkPlayable({ name: 'a.mov', type: '' }, no);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('.mov');
  });

  it('rejects non-video files', () => {
    expect(checkPlayable({ name: 'notes.txt', type: 'text/plain' }, yes).ok).toBe(false);
  });
});

describe('helpers', () => {
  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe('5.0 GB');
  });

  it('hashes equal content equally and different content differently', async () => {
    const a = await quickHash(new Blob(['hello world']));
    const b = await quickHash(new Blob(['hello world']));
    const c = await quickHash(new Blob(['hello there']));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
