import type { IncomingMessage } from 'node:http';

export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    now: number,
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  /** Takes one token. Returns false when the bucket is empty. */
  take(now: number): boolean {
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export type BucketName = 'general' | 'chat' | 'signal' | 'lobby' | 'queueAdd';

const SPECS: Record<BucketName, [number, number]> = {
  general: [60, 30],
  chat: [5, 1],
  signal: [200, 100],
  lobby: [10, 1 / 3],
  queueAdd: [5, 1 / 3],
};

/** The per-connection set of buckets. */
export class ConnectionLimiter {
  private buckets: Record<BucketName, TokenBucket>;

  constructor(now: number) {
    this.buckets = {
      general: new TokenBucket(...SPECS.general, now),
      chat: new TokenBucket(...SPECS.chat, now),
      signal: new TokenBucket(...SPECS.signal, now),
      lobby: new TokenBucket(...SPECS.lobby, now),
      queueAdd: new TokenBucket(...SPECS.queueAdd, now),
    };
  }

  /** `rtc:signal` uses its own bucket only. Others use general plus their own type bucket if listed. */
  allow(type: string, now: number): boolean {
    if (type === 'rtc:signal') return this.buckets.signal.take(now);
    if (!this.buckets.general.take(now)) return false;
    if (type === 'chat:send') return this.buckets.chat.take(now);
    if (type === 'queue:add') return this.buckets.queueAdd.take(now);
    if (type === 'room:create' || type === 'room:join' || type === 'room:peek') return this.buckets.lobby.take(now);
    return true;
  }
}

/** Counts rate-limit events inside a sliding window. */
export class AbuseCounter {
  private times: number[] = [];

  constructor(
    private readonly limit = 20,
    private readonly windowMs = 10_000,
  ) {}

  /** Records an event and returns true when the limit is reached. */
  hit(now: number): boolean {
    this.times.push(now);
    this.times = this.times.filter((t) => now - t <= this.windowMs);
    return this.times.length >= this.limit;
  }
}

/**
 * Resolves the client IP. With `hops = n` the n-th entry from the right of X-Forwarded-For is used
 * (the one appended by the nearest trusted proxy). Entries further left are client-controlled and ignored.
 */
export function clientIp(req: Pick<IncomingMessage, 'headers' | 'socket'>, hops: number): string {
  const fallback = req.socket.remoteAddress ?? 'unknown';
  if (hops <= 0) return fallback;
  const header = req.headers['x-forwarded-for'];
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (!raw) return fallback;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < hops) return fallback;
  return parts[parts.length - hops];
}

/** Failed password attempts per (ip, room): 5 failures in 60 s lock the pair out for 30 s. */
export class PasswordGuard {
  private entries = new Map<string, { fails: number[]; lockedUntil: number }>();

  constructor(
    private readonly maxFails = 5,
    private readonly windowMs = 60_000,
    private readonly lockMs = 30_000,
  ) {}

  private key(ip: string, code: string) {
    return `${ip}|${code}`;
  }

  isLocked(ip: string, code: string, now: number): boolean {
    const e = this.entries.get(this.key(ip, code));
    return !!e && e.lockedUntil > now;
  }

  recordFailure(ip: string, code: string, now: number): void {
    const k = this.key(ip, code);
    const e = this.entries.get(k) ?? { fails: [], lockedUntil: 0 };
    e.fails = e.fails.filter((t) => now - t <= this.windowMs);
    e.fails.push(now);
    if (e.fails.length >= this.maxFails) {
      e.lockedUntil = now + this.lockMs;
      e.fails = [];
    }
    this.entries.set(k, e);
  }

  clear(ip: string, code: string): void {
    this.entries.delete(this.key(ip, code));
  }

  clearRoom(code: string): void {
    for (const k of this.entries.keys()) if (k.endsWith(`|${code}`)) this.entries.delete(k);
  }

  sweep(now: number): void {
    for (const [k, e] of this.entries) {
      e.fails = e.fails.filter((t) => now - t <= this.windowMs);
      if (e.fails.length === 0 && e.lockedUntil <= now) this.entries.delete(k);
    }
  }
}
