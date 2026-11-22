import { VIDEO_ID_RE } from '../../shared/constants';
import { sanitizeTitle } from '../../shared/validate';

/** Resolves a YouTube video title. Injected into `Room` so tests and other hosts can swap it. */
export interface MetadataResolver {
  /** The sanitized title, or null when it cannot be resolved. Never throws. */
  resolveTitle(videoId: string): Promise<string | null>;
}

export interface OEmbedOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Largest response body that will be read. */
  maxBytes?: number;
  cacheSize?: number;
  /** Lookups allowed at once. Further lookups return null instead of queueing. */
  maxInFlight?: number;
}

/** Resolver that never finds anything. */
export const nullMetadata: MetadataResolver = { resolveTitle: () => Promise.resolve(null) };

/**
 * YouTube oEmbed title lookup. The host is fixed and the video id is matched against `VIDEO_ID_RE` first,
 * so a client cannot steer the request elsewhere. Thumbnails are derived from the id by the client and
 * are not fetched here. Results are cached in memory (LRU); failures are not cached.
 */
export function createOEmbedResolver(opts: OEmbedOptions = {}): MetadataResolver {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 3000;
  const maxBytes = opts.maxBytes ?? 16 * 1024;
  const cacheSize = opts.cacheSize ?? 500;
  const maxInFlight = opts.maxInFlight ?? 3;
  const cache = new Map<string, string>();
  const inFlight = new Map<string, Promise<string | null>>();

  async function readBody(res: Response, signal: AbortSignal): Promise<string | null> {
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        if (signal.aborted) return null;
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) return null;
        chunks.push(value);
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  async function lookup(videoId: string): Promise<string | null> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
      const timedOut = new Promise<null>((resolve) => ctl.signal.addEventListener('abort', () => resolve(null)));
      const work = (async () => {
        const res = await doFetch(url, { signal: ctl.signal, redirect: 'error', headers: { Accept: 'application/json' } });
        if (!res.ok) return null;
        const body = await readBody(res, ctl.signal);
        if (body === null) return null;
        const json: unknown = JSON.parse(body);
        const title = typeof json === 'object' && json !== null ? (json as { title?: unknown }).title : undefined;
        return sanitizeTitle(title) ?? null;
      })();
      work.catch(() => undefined);
      return await Promise.race([work, timedOut]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      ctl.abort();
    }
  }

  return {
    async resolveTitle(videoId) {
      if (!VIDEO_ID_RE.test(videoId)) return null;
      const hit = cache.get(videoId);
      if (hit !== undefined) {
        cache.delete(videoId);
        cache.set(videoId, hit);
        return hit;
      }
      const pending = inFlight.get(videoId);
      if (pending) return pending;
      if (inFlight.size >= maxInFlight) return null;
      const p = lookup(videoId).then((title) => {
        if (title !== null) {
          cache.set(videoId, title);
          if (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
        }
        return title;
      });
      inFlight.set(videoId, p);
      try {
        return await p;
      } finally {
        inFlight.delete(videoId);
      }
    },
  };
}
