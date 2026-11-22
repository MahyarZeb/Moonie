import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { isOriginAllowed } from '../src/origin';
import { hashPassword, verifyPassword } from '../src/password';
import { AbuseCounter, ConnectionLimiter, PasswordGuard, TokenBucket, clientIp } from '../src/rateLimit';

const fastCost = { N: 1024, r: 8, p: 1 };

describe('password', () => {
  it('verifies the right password and rejects wrong ones', async () => {
    const h = await hashPassword('secret1', fastCost);
    expect(await verifyPassword('secret1', h, fastCost)).toBe(true);
    expect(await verifyPassword('secret2', h, fastCost)).toBe(false);
    expect(await verifyPassword('', h, fastCost)).toBe(false);
  });
  it('uses a different salt each time', async () => {
    const a = await hashPassword('same-pass', fastCost);
    const b = await hashPassword('same-pass', fastCost);
    expect(a.salt.equals(b.salt)).toBe(false);
    expect(a.hash.equals(b.hash)).toBe(false);
  });
  it('works with the default cost', async () => {
    const h = await hashPassword('default-cost');
    expect(await verifyPassword('default-cost', h)).toBe(true);
  });
});

describe('origin', () => {
  it('fails closed when nothing is configured', () => {
    expect(isOriginAllowed('https://a.com', [], false)).toBe(false);
  });
  it('matches exact origins only', () => {
    const list = ['https://moonie.vercel.app'];
    expect(isOriginAllowed('https://moonie.vercel.app', list, false)).toBe(true);
    expect(isOriginAllowed('https://moonie.vercel.app.evil.io', list, false)).toBe(false);
    expect(isOriginAllowed('http://moonie.vercel.app', list, false)).toBe(false);
    expect(isOriginAllowed('null', list, false)).toBe(false);
  });
  it('supports wildcard subdomains but not the bare domain', () => {
    const list = ['https://*.vercel.app'];
    expect(isOriginAllowed('https://x-git-main.vercel.app', list, false)).toBe(true);
    expect(isOriginAllowed('https://vercel.app', list, false)).toBe(false);
    expect(isOriginAllowed('https://evilvercel.app', list, false)).toBe(false);
    expect(isOriginAllowed('http://x.vercel.app', list, false)).toBe(false);
  });
  it('supports * and the missing-origin switch', () => {
    expect(isOriginAllowed('https://anything.io', ['*'], false)).toBe(true);
    expect(isOriginAllowed(undefined, ['https://a.com'], false)).toBe(false);
    expect(isOriginAllowed(undefined, ['https://a.com'], true)).toBe(true);
  });
});

describe('clientIp', () => {
  const req = (xff: string | undefined, remote = '10.0.0.1') =>
    ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: remote } }) as never;
  it('takes the n-th entry from the right and ignores a spoofed leftmost entry', () => {
    expect(clientIp(req('6.6.6.6, 2.2.2.2'), 1)).toBe('2.2.2.2');
    expect(clientIp(req('6.6.6.6, 5.5.5.5, 2.2.2.2'), 2)).toBe('5.5.5.5');
  });
  it('falls back to the socket address', () => {
    expect(clientIp(req('2.2.2.2'), 0)).toBe('10.0.0.1');
    expect(clientIp(req('2.2.2.2'), 2)).toBe('10.0.0.1');
    expect(clientIp(req(undefined), 1)).toBe('10.0.0.1');
  });
});

describe('rate limiting', () => {
  it('refills a token bucket over time', () => {
    const b = new TokenBucket(2, 1, 0);
    expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(false);
    expect(b.take(1000)).toBe(true);
    expect(b.take(1000)).toBe(false);
  });
  it('lets the lobby re-peek every 5 s indefinitely', () => {
    const l = new ConnectionLimiter(0);
    for (let i = 0; i < 200; i++) expect(l.allow('room:peek', i * 5000)).toBe(true);
  });
  it('limits chat separately and rtc:signal only by its own bucket', () => {
    const l = new ConnectionLimiter(0);
    for (let i = 0; i < 5; i++) expect(l.allow('chat:send', 0)).toBe(true);
    expect(l.allow('chat:send', 0)).toBe(false);
    for (let i = 0; i < 200; i++) expect(l.allow('rtc:signal', 0)).toBe(true);
    expect(l.allow('rtc:signal', 0)).toBe(false);
    expect(l.allow('sync:ping', 0)).toBe(true);
  });
  it('closes after 20 events in 10 s', () => {
    const a = new AbuseCounter();
    for (let i = 0; i < 19; i++) expect(a.hit(i * 100)).toBe(false);
    expect(a.hit(1900)).toBe(true);
  });
  it('locks out after 5 failed passwords and unlocks after 30 s', () => {
    const g = new PasswordGuard();
    for (let i = 0; i < 4; i++) g.recordFailure('ip', 'ROOM', 1000 + i);
    expect(g.isLocked('ip', 'ROOM', 2000)).toBe(false);
    g.recordFailure('ip', 'ROOM', 1500);
    expect(g.isLocked('ip', 'ROOM', 2000)).toBe(true);
    expect(g.isLocked('other', 'ROOM', 2000)).toBe(false);
    expect(g.isLocked('ip', 'ROOM', 32_000)).toBe(false);
  });
});

describe('config', () => {
  it('falls back to defaults for invalid numbers', () => {
    const c = loadConfig({ MAX_ROOMS: 'abc', HOST_GRACE_MS: '-5', IDLE_MS: '1000', ALLOWED_ORIGINS: 'a, b' });
    expect(c.maxRooms).toBe(300);
    expect(c.hostGraceMs).toBe(10000);
    expect(c.idleMs).toBe(1000);
    expect(c.allowedOrigins).toEqual(['a', 'b']);
    expect(c.trustProxyHops).toBe(1);
  });
  it('has an empty allow-list when unset', () => {
    expect(loadConfig({}).allowedOrigins).toEqual([]);
  });
});
