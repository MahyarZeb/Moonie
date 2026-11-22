import { describe, expect, it } from 'vitest';
import { createOEmbedResolver } from '../src/metadata';
import { makeCtx, profile } from './helpers';

const V1 = 'dQw4w9WgXcQ';
const V2 = 'aaaaaaaaaaa';

type Ctx = ReturnType<typeof makeCtx>;
type FetchFn = typeof fetch;

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

/** A fetch stub that records calls. */
function stub(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = ((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(handler(String(url), init));
  }) as unknown as FetchFn;
  return { fn, calls };
}

/** Never answers; rejects when the request is aborted, like real fetch. */
const hang = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });

describe('oEmbed resolver', () => {
  it('returns the title and calls the fixed YouTube host with the id in the url parameter', async () => {
    const s = stub(() => json({ title: 'Never Gonna Give You Up', author_name: 'x' }));
    const r = createOEmbedResolver({ fetch: s.fn });
    expect(await r.resolveTitle(V1)).toBe('Never Gonna Give You Up');
    const url = new URL(s.calls[0]!.url);
    expect(url.origin + url.pathname).toBe('https://www.youtube.com/oembed');
    expect(url.searchParams.get('url')).toBe(`https://www.youtube.com/watch?v=${V1}`);
    expect(s.calls[0]!.init?.redirect).toBe('error');
  });

  it('caches successes and does not fetch twice', async () => {
    const s = stub(() => json({ title: 'Cached' }));
    const r = createOEmbedResolver({ fetch: s.fn });
    await r.resolveTitle(V1);
    expect(await r.resolveTitle(V1)).toBe('Cached');
    expect(s.calls).toHaveLength(1);
  });

  it('evicts the oldest entry past the cache size', async () => {
    const s = stub((url) => json({ title: `T${s.calls.length}:${url.length}` }));
    const r = createOEmbedResolver({ fetch: s.fn, cacheSize: 1 });
    await r.resolveTitle(V1);
    await r.resolveTitle(V2);
    await r.resolveTitle(V1);
    expect(s.calls).toHaveLength(3);
  });

  it('does not cache failures, so a later call can succeed', async () => {
    let ok = false;
    const s = stub(() => (ok ? json({ title: 'Back' }) : new Response('nope', { status: 500 })));
    const r = createOEmbedResolver({ fetch: s.fn });
    expect(await r.resolveTitle(V1)).toBeNull();
    ok = true;
    expect(await r.resolveTitle(V1)).toBe('Back');
  });

  it('returns null on a non-200 answer', async () => {
    for (const status of [401, 404, 429, 500]) {
      const r = createOEmbedResolver({ fetch: stub(() => new Response('{"title":"x"}', { status })).fn });
      expect(await r.resolveTitle(V1)).toBeNull();
    }
  });

  it('returns null when the request times out', async () => {
    const r = createOEmbedResolver({ fetch: stub(hang).fn, timeoutMs: 20 });
    expect(await r.resolveTitle(V1)).toBeNull();
  });

  it('returns null when fetch ignores the abort signal and never answers', async () => {
    const r = createOEmbedResolver({ fetch: stub(() => new Promise<Response>(() => undefined)).fn, timeoutMs: 20 });
    expect(await r.resolveTitle(V1)).toBeNull();
  });

  it('returns null when the request throws or redirects', async () => {
    const r = createOEmbedResolver({
      fetch: (() => Promise.reject(new TypeError('redirect mode is set to error'))) as unknown as FetchFn,
    });
    expect(await r.resolveTitle(V1)).toBeNull();
  });

  it('rejects an oversized body, declared or streamed', async () => {
    const big = JSON.stringify({ title: 'x'.repeat(40_000) });
    const declared = createOEmbedResolver({
      fetch: stub(() => new Response(big, { status: 200, headers: { 'content-length': String(big.length) } })).fn,
    });
    expect(await declared.resolveTitle(V1)).toBeNull();
    const streamed = createOEmbedResolver({
      fetch: stub(() => {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            const chunk = new TextEncoder().encode('x'.repeat(8000));
            for (let i = 0; i < 4; i++) c.enqueue(chunk);
            c.close();
          },
        });
        return new Response(body, { status: 200 });
      }).fn,
    });
    expect(await streamed.resolveTitle(V1)).toBeNull();
  });

  it('returns null for invalid JSON or a missing or non-string title', async () => {
    for (const body of ['<html>', '{}', '{"title":42}', 'null', '[]']) {
      const r = createOEmbedResolver({ fetch: stub(() => new Response(body, { status: 200 })).fn });
      expect(await r.resolveTitle(V1)).toBeNull();
    }
  });

  it('sanitizes a hostile title: control and bidi characters stripped, length capped', async () => {
    const hostile = `\u202eevil\u0000\u200b title\u0007 ${'y'.repeat(300)}`;
    const r = createOEmbedResolver({ fetch: stub(() => json({ title: hostile })).fn });
    const title = (await r.resolveTitle(V1))!;
    expect(title).not.toMatch(/[\u0000-\u001f\u202a-\u202e\u200b-\u200f]/);
    expect(title.startsWith('evil title')).toBe(true);
    expect(Array.from(title).length).toBeLessThanOrEqual(120);
  });

  it('never fetches for an id that is not 11 safe characters', async () => {
    const s = stub(() => json({ title: 'x' }));
    const r = createOEmbedResolver({ fetch: s.fn });
    for (const id of ['short', '../../etc/passwd', 'dQw4w9WgXcQ&x=1', 'dQw4w9WgXc?', '']) {
      expect(await r.resolveTitle(id)).toBeNull();
    }
    expect(s.calls).toHaveLength(0);
  });

  it('shares one request between concurrent lookups of the same id and caps concurrency', async () => {
    const s = stub(() => json({ title: 'One' }));
    const r = createOEmbedResolver({ fetch: s.fn });
    const [a, b] = await Promise.all([r.resolveTitle(V1), r.resolveTitle(V1)]);
    expect([a, b]).toEqual(['One', 'One']);
    expect(s.calls).toHaveLength(1);

    const capped = createOEmbedResolver({ fetch: stub(hang).fn, timeoutMs: 30, maxInFlight: 1 });
    const first = capped.resolveTitle(V1);
    expect(await capped.resolveTitle(V2)).toBeNull();
    expect(await first).toBeNull();
  });
});

async function createRoom(t: Ctx) {
  const c = t.connect();
  await t.send(c.conn, { type: 'room:create', name: 'Movie night', theme: 'cloud', ...profile('Host') });
  const joined = c.socket.last('room:joined')!;
  return { ...c, id: joined.selfId, code: joined.snapshot.code };
}

async function join(t: Ctx, code: string, name = 'Guest') {
  const c = t.connect();
  await t.send(c.conn, { type: 'room:join', code, ...profile(name, 'fox') });
  return { ...c, id: c.socket.last('room:joined')!.selfId };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('room title resolution', () => {
  it('replaces the client title hint with the resolved title on queued items and publishes it', async () => {
    const t = makeCtx();
    let release: (v: string | null) => void = () => undefined;
    t.metadata.resolveTitle = () => new Promise<string | null>((r) => (release = r));
    const host = await createRoom(t);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(host.conn, { type: 'queue:add', videoId: V2, title: 'Client says this' });
    expect(t.registry.get(host.code)!.queue[0]!.title).toBe('Client says this');
    release('Resolved title');
    await tick();
    expect(t.registry.get(host.code)!.queue[0]!.title).toBe('Resolved title');
    expect(host.socket.last('queue:updated')!.queue[0]!.title).toBe('Resolved title');
  });

  it('resolves titles for suggestions and the current video, and a failed lookup keeps the hint', async () => {
    const t = makeCtx();
    t.metadata.titles.set(V1, 'Now playing title');
    t.metadata.titles.set(V2, 'Suggested title');
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    await t.send(host.conn, { type: 'queue:add', videoId: V1 });
    await t.send(guest.conn, { type: 'queue:add', videoId: V2 });
    await t.send(guest.conn, { type: 'queue:add', videoId: 'bbbbbbbbbbb', title: 'Hint stays' });
    await tick();
    const room = t.registry.get(host.code)!;
    expect(room.media).toMatchObject({ kind: 'youtube', videoId: V1, title: 'Now playing title' });
    expect(guest.socket.last('media:state')!.media).toMatchObject({ title: 'Now playing title' });
    expect(room.suggestions.map((s) => s.title)).toEqual(['Suggested title', 'Hint stays']);
    expect(guest.socket.of('suggestions:updated').at(-1)!.suggestions[0]!.title).toBe('Suggested title');
  });

  it('is non-blocking: the add is acknowledged before the title resolves', async () => {
    const t = makeCtx();
    let release: (v: string | null) => void = () => undefined;
    t.metadata.resolveTitle = () => new Promise<string | null>((r) => (release = r));
    const host = await createRoom(t);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(host.conn, { type: 'queue:add', ref: 'x', videoId: V2 });
    expect(host.socket.last('queue:updated')?.ref).toBe('x');
    release('Late title');
    await tick();
    expect(t.registry.get(host.code)!.queue[0]!.title).toBe('Late title');
  });

  it('a throwing resolver never breaks the add', async () => {
    const t = makeCtx();
    t.metadata.resolveTitle = () => Promise.reject(new Error('boom'));
    const host = await createRoom(t);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(host.conn, { type: 'queue:add', videoId: V2 });
    await tick();
    expect(t.registry.get(host.code)!.queue).toHaveLength(1);
  });
});
