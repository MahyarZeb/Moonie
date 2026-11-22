import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaState, RtcSignalData } from '@shared/protocol';
import { createRoomStore } from '@/lib/room/roomStore';
import { FakeTransport, makeSnapshot } from '@/test/fakeTransport';
import { TransportError } from '@/lib/signaling/types';
import { mapCaptureError } from './capture';
import { buildIceServers } from './iceConfig';
import { PeerLink } from './PeerLink';
import { ShareBroadcaster } from './ShareBroadcaster';
import { ShareViewer, type ViewerState } from './ShareViewer';

// ---------------------------------------------------------------- fakes

class FakeTrack {
  stopped = false;
  contentHint = '';
  private ended = new Set<() => void>();
  constructor(readonly kind: 'video' | 'audio') {}
  addEventListener(_t: string, fn: () => void) {
    this.ended.add(fn);
  }
  removeEventListener(_t: string, fn: () => void) {
    this.ended.delete(fn);
  }
  stop() {
    this.stopped = true;
  }
  fireEnded() {
    for (const fn of [...this.ended]) fn();
  }
}

class FakeStream {
  video = new FakeTrack('video');
  audio = new FakeTrack('audio');
  getTracks() {
    return [this.video, this.audio];
  }
  getVideoTracks() {
    return [this.video];
  }
  getAudioTracks() {
    return [this.audio];
  }
}

class FakePc {
  signalingState = 'stable';
  connectionState = 'new';
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((ev: { candidate: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((ev: unknown) => void) | null = null;
  closed = false;
  restarts = 0;
  tracks: unknown[] = [];
  candidates: unknown[] = [];
  implicitDescriptions = true;

  async setLocalDescription(desc?: { type: string; sdp: string }) {
    if (!desc && !this.implicitDescriptions) throw new TypeError('argument required');
    const type = desc?.type ?? (this.signalingState === 'have-remote-offer' ? 'answer' : 'offer');
    this.localDescription = { type, sdp: desc?.sdp ?? `implicit-${type}` };
    this.signalingState = type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(d: { type: string; sdp: string }) {
    this.remoteDescription = d;
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
  async createOffer() {
    return { type: 'offer', sdp: 'created-offer' };
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'created-answer' };
  }
  async addIceCandidate(c: unknown) {
    this.candidates.push(c);
  }
  addTrack(track: unknown) {
    this.tracks.push(track);
    return { getParameters: () => ({ encodings: [] as unknown[] }), setParameters: async () => undefined };
  }
  restartIce() {
    this.restarts++;
  }
  close() {
    this.closed = true;
  }
  setState(s: string) {
    this.connectionState = s;
    this.onconnectionstatechange?.();
  }
}

function pcFactory() {
  const pcs: FakePc[] = [];
  const createPc = () => {
    const pc = new FakePc();
    pcs.push(pc);
    return pc as unknown as RTCPeerConnection;
  };
  return { pcs, createPc };
}

const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const offer: RtcSignalData = { t: 'description', description: { type: 'offer', sdp: 'remote-offer' } };

// ---------------------------------------------------------------- PeerLink

describe('PeerLink', () => {
  it('buffers candidates until a remote description exists, then flushes them', async () => {
    const { pcs, createPc } = pcFactory();
    const link = new PeerLink('l1', { polite: true, signal: () => undefined, createPc });
    const pc = pcs[0]!;
    await link.handle({ t: 'candidate', candidate: { candidate: 'c1' } });
    await link.handle({ t: 'candidate', candidate: null });
    expect(pc.candidates).toHaveLength(0);
    await link.handle(offer);
    expect(pc.candidates).toEqual([{ candidate: 'c1' }, undefined]);
  });

  it('answers an offer, using createAnswer when setLocalDescription() has no implicit form', async () => {
    const { pcs, createPc } = pcFactory();
    const sent: RtcSignalData[] = [];
    const link = new PeerLink('l1', { polite: true, signal: (d) => sent.push(d), createPc });
    pcs[0]!.implicitDescriptions = false;
    await link.handle(offer);
    expect(sent).toEqual([{ t: 'description', description: { type: 'answer', sdp: 'created-answer' } }]);
  });

  it('creates an offer on negotiationneeded, with the createOffer fallback', async () => {
    const { pcs, createPc } = pcFactory();
    const sent: RtcSignalData[] = [];
    new PeerLink('l1', { polite: false, signal: (d) => sent.push(d), createPc });
    pcs[0]!.implicitDescriptions = false;
    pcs[0]!.onnegotiationneeded?.();
    await tick();
    expect(sent).toEqual([{ t: 'description', description: { type: 'offer', sdp: 'created-offer' } }]);
  });

  it('impolite peer ignores a colliding offer, polite peer accepts it', async () => {
    const make = async (polite: boolean) => {
      const { pcs, createPc } = pcFactory();
      const link = new PeerLink('l1', { polite, signal: () => undefined, createPc });
      pcs[0]!.signalingState = 'have-local-offer';
      await link.handle(offer);
      return pcs[0]!.remoteDescription;
    };
    expect(await make(false)).toBeNull();
    expect(await make(true)).toMatchObject({ sdp: 'remote-offer' });
  });

  it('does not send candidates over the server caps', () => {
    const { pcs, createPc } = pcFactory();
    const sent: RtcSignalData[] = [];
    new PeerLink('l1', { polite: false, signal: (d) => sent.push(d), createPc });
    const cand = (candidate: string, sdpMid?: string) => ({ candidate: { toJSON: () => ({ candidate, sdpMid }) } });
    pcs[0]!.onicecandidate?.(cand('x'.repeat(2049)));
    pcs[0]!.onicecandidate?.(cand('ok', 'm'.repeat(257)));
    pcs[0]!.onicecandidate?.(cand('fine', '0'));
    expect(sent).toEqual([{ t: 'candidate', candidate: { candidate: 'fine', sdpMid: '0' } }]);
  });

  describe('ICE restart', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('restarts after failure at most twice, then gives up', () => {
      const { pcs, createPc } = pcFactory();
      const onGiveUp = vi.fn();
      new PeerLink('l1', { polite: false, autoRestart: true, signal: () => undefined, createPc, onGiveUp });
      const pc = pcs[0]!;
      pc.setState('failed');
      pc.setState('failed');
      expect(pc.restarts).toBe(2);
      expect(onGiveUp).not.toHaveBeenCalled();
      pc.setState('failed');
      expect(onGiveUp).toHaveBeenCalledTimes(1);
    });

    it('waits 4 s on disconnected before restarting', () => {
      const { pcs, createPc } = pcFactory();
      new PeerLink('l1', { polite: false, autoRestart: true, signal: () => undefined, createPc });
      pcs[0]!.setState('disconnected');
      vi.advanceTimersByTime(3900);
      expect(pcs[0]!.restarts).toBe(0);
      vi.advanceTimersByTime(200);
      expect(pcs[0]!.restarts).toBe(1);
    });
  });
});

// ---------------------------------------------------------------- ShareViewer

describe('ShareViewer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const transport = new FakeTransport();
    const { pcs, createPc } = pcFactory();
    let n = 0;
    const states: ViewerState[] = [];
    const viewer = new ShareViewer({
      transport,
      sharerId: 'host',
      sessionId: 'sess',
      onStream: () => undefined,
      onState: (s) => states.push(s),
      createPc,
      newLinkId: () => `link${++n}`,
    });
    return { transport, pcs, viewer, states };
  }

  const ready = (t: FakeTransport) => t.signals.filter((s) => s.data.t === 'viewer-ready');

  it('creates a fresh link and linkId for the initial ready and for the automatic retry', async () => {
    const { transport, pcs, viewer, states } = setup();
    viewer.start();
    expect(ready(transport)).toEqual([{ to: 'host', sessionId: 'sess', linkId: 'link1', data: { t: 'viewer-ready', reason: 'initial' } }]);
    expect(pcs).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(ready(transport)[1]).toMatchObject({ linkId: 'link2', data: { t: 'viewer-ready', reason: 'retry' } });
    expect(pcs).toHaveLength(2);
    expect(pcs[0]!.closed).toBe(true);
    expect(pcs[1]!.closed).toBe(false);
    expect(states).toEqual(['reconnecting']);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(viewer.state).toBe('failed');
    expect(pcs[1]!.closed).toBe(true);

    viewer.retry();
    expect(ready(transport)[2]).toMatchObject({ linkId: 'link3', data: { reason: 'retry' } });
    viewer.dispose();
    expect(pcs[2]!.closed).toBe(true);
  });

  it('ignores signals whose linkId is not the current link and signals from other peers or sessions', async () => {
    const { transport, pcs, viewer } = setup();
    viewer.start();
    await vi.advanceTimersByTimeAsync(15_000); // now on link2
    const send = (over: Partial<{ from: string; sessionId: string; linkId: string }>) =>
      transport.emit({ type: 'rtc:signal', from: 'host', sessionId: 'sess', linkId: 'link2', data: offer, ...over });
    send({ linkId: 'link1' });
    send({ from: 'someone-else' });
    send({ sessionId: 'old-session' });
    await tick();
    expect(pcs[1]!.remoteDescription).toBeNull();
    send({});
    await tick();
    expect(pcs[1]!.remoteDescription).toMatchObject({ sdp: 'remote-offer' });
    // the answer goes back stamped with the current link
    expect(transport.signals.at(-1)).toMatchObject({ linkId: 'link2', data: { t: 'description' } });
  });

  it('reports connected and cancels the connect timeout', async () => {
    const { pcs, viewer, states, transport } = setup();
    viewer.start();
    pcs[0]!.setState('connected');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(states).toEqual(['connected']);
    expect(ready(transport)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- ShareBroadcaster

describe('ShareBroadcaster', () => {
  const screen = (sessionId = 's1'): MediaState => ({ kind: 'screen', rev: 1, sharerId: 'me', sessionId, hasAudio: true });

  function setup(opts: { reject?: boolean } = {}) {
    const store = createRoomStore();
    const transport = new FakeTransport();
    const { pcs, createPc } = pcFactory();
    const stream = new FakeStream();
    const ended = vi.fn();
    const playback = { rev: 1, status: 'paused' as const, positionSec: 0, updatedAt: 0 };

    // Mirror the real app: every server message reaches the store.
    transport.onMessage((m) => store.dispatch(m));
    transport.emit({ type: 'room:joined', selfId: 'me', resumeToken: 't', snapshot: makeSnapshot(), resumed: false });
    for (const id of ['v1', 'v2']) {
      transport.emit({ type: 'participant:joined', participant: { id, name: id, avatar: 'cat', joinedAt: 2, connected: true } });
    }
    transport.requestImpl = async (msg) => {
      if (opts.reject) throw new TransportError('not_host', 'nope');
      const reply = { type: 'media:state' as const, media: screen(), playback, queue: [], ref: 'r1' };
      if (msg.type === 'share:start') transport.emit(reply);
      return reply;
    };
    const share = new ShareBroadcaster({
      transport,
      store,
      createPc,
      capture: async () => ({ ok: true, stream: stream as unknown as MediaStream, hasAudio: true }),
      onEnded: ended,
    });
    const signal = (from: string, linkId: string, data: RtcSignalData, sessionId = 's1') =>
      transport.emit({ type: 'rtc:signal', from, sessionId, linkId, data });
    return { store, transport, pcs, stream, share, ended, signal, playback };
  }

  const ready: RtcSignalData = { t: 'viewer-ready', reason: 'initial' };

  it('starts a session, adds every track per viewer and stamps signals with session and link ids', async () => {
    const { share, signal, pcs, transport, stream } = setup();
    await share.start();
    expect(share.getState().status).toBe('sharing');
    expect(stream.video.contentHint).toBe('detail');
    expect(transport.sent).toEqual([]); // share:start goes through request()

    signal('v1', 'a1', ready);
    expect(pcs).toHaveLength(1);
    expect(pcs[0]!.tracks).toHaveLength(2);
    pcs[0]!.onnegotiationneeded?.();
    await tick();
    expect(transport.signals.at(-1)).toMatchObject({ to: 'v1', sessionId: 's1', linkId: 'a1', data: { t: 'description' } });
  });

  it('ignores a repeated viewer-ready for the same link and replaces the link on a new linkId', async () => {
    const { share, signal, pcs } = setup();
    await share.start();
    signal('v1', 'a1', ready);
    signal('v1', 'a1', ready);
    expect(pcs).toHaveLength(1);
    signal('v1', 'a2', { t: 'viewer-ready', reason: 'retry' });
    expect(pcs).toHaveLength(2);
    expect(pcs[0]!.closed).toBe(true);
    expect(pcs[1]!.closed).toBe(false);
    signal('v2', 'b1', ready);
    expect(pcs).toHaveLength(3);
    expect(pcs[1]!.closed).toBe(false);
  });

  it('drops signals with a stale linkId, an unknown session, or from non-participants', async () => {
    const { share, signal, pcs } = setup();
    await share.start();
    signal('v1', 'a1', ready);
    signal('v1', 'a2', ready);
    const answer: RtcSignalData = { t: 'description', description: { type: 'answer', sdp: 'ans' } };
    pcs[1]!.signalingState = 'have-local-offer';
    signal('v1', 'a1', answer); // stale link
    signal('v1', 'a2', answer, 'other-session');
    signal('ghost', 'g1', ready);
    await tick();
    expect(pcs).toHaveLength(2);
    expect(pcs[1]!.remoteDescription).toBeNull();
    signal('v1', 'a2', answer);
    await tick();
    expect(pcs[1]!.remoteDescription).toMatchObject({ sdp: 'ans' });
  });

  it('tears everything down when the store stops showing the session (host change, media change, room closed)', async () => {
    for (const trigger of ['media', 'host', 'closed'] as const) {
      const { share, signal, pcs, stream, store, transport, ended, playback } = setup();
      await share.start();
      signal('v1', 'a1', ready);
      if (trigger === 'media') transport.emit({ type: 'media:state', media: null, playback, queue: [] });
      if (trigger === 'host') {
        transport.emit({ type: 'media:state', media: null, playback, queue: [] });
        transport.emit({ type: 'host:changed', hostId: 'v1', reason: 'transfer' });
      }
      if (trigger === 'closed') transport.emit({ type: 'room:closed', reason: 'expired' });
      expect(stream.video.stopped && stream.audio.stopped).toBe(true);
      expect(pcs[0]!.closed).toBe(true);
      expect(share.getState().status).toBe('idle');
      expect(ended).toHaveBeenCalledTimes(1);
      expect(transport.sent.some((m) => m.type === 'share:stop')).toBe(false);
      void store;
    }
  });

  it('keeps sharing when unrelated store updates arrive', async () => {
    const { share, transport } = setup();
    await share.start();
    transport.emit({ type: 'chat:typing', id: 'v1', typing: true });
    transport.emit({ type: 'participant:updated', participant: { id: 'v1', name: 'v1', avatar: 'fox', joinedAt: 2, connected: true } });
    expect(share.getState().status).toBe('sharing');
  });

  it('closes the link of a viewer who left', async () => {
    const { share, signal, pcs, transport } = setup();
    await share.start();
    signal('v1', 'a1', ready);
    transport.emit({ type: 'participant:left', id: 'v1', reason: 'left' });
    expect(pcs[0]!.closed).toBe(true);
    expect(share.getState().links).toEqual({});
  });

  it('sends share:stop and stops tracks when the browser ends the capture', async () => {
    const { share, stream, transport, signal, pcs } = setup();
    await share.start();
    signal('v1', 'a1', ready);
    stream.video.fireEnded();
    expect(stream.video.stopped && stream.audio.stopped).toBe(true);
    expect(pcs[0]!.closed).toBe(true);
    expect(transport.sent).toContainEqual({ type: 'share:stop' });
    expect(share.getState().status).toBe('idle');
  });

  it('stops every track and reports the reason when share:start is rejected', async () => {
    const { share, stream, transport } = setup({ reject: true });
    await share.start();
    expect(stream.video.stopped && stream.audio.stopped).toBe(true);
    expect(share.getState()).toMatchObject({ status: 'idle', stream: null, error: { reason: 'rejected' } });
    expect(share.getState().error?.message).toContain("Couldn't start sharing: Only the host can share.");
    expect(transport.sent).toEqual([]);
  });

  it('reports a capture failure without calling the server', async () => {
    const transport = new FakeTransport();
    const store = createRoomStore();
    const share = new ShareBroadcaster({
      transport,
      store,
      capture: async () => ({ ok: false, reason: 'denied', message: 'blocked' }),
    });
    await share.start();
    expect(share.getState()).toMatchObject({ status: 'idle', error: { reason: 'denied', message: 'blocked' } });
  });
});

// ---------------------------------------------------------------- helpers

describe('capture and ice helpers', () => {
  it('maps getDisplayMedia errors', () => {
    expect(mapCaptureError({ name: 'NotAllowedError' })).toMatchObject({ reason: 'denied' });
    expect(mapCaptureError({ name: 'NotFoundError' })).toMatchObject({ reason: 'cancelled' });
    expect(mapCaptureError({ name: 'AbortError' })).toMatchObject({ reason: 'cancelled' });
    expect(mapCaptureError(new Error('boom'))).toMatchObject({ reason: 'error', message: expect.stringContaining('boom') });
  });

  it('builds ice servers from env values', () => {
    expect(buildIceServers({})).toEqual([{ urls: ['stun:stun.l.google.com:19302'] }]);
    expect(buildIceServers({ stunUrls: 'stun:a, stun:b', turnUrl: 'turn:t1,turn:t2', turnUsername: 'u', turnCredential: 'c' })).toEqual([
      { urls: ['stun:a', 'stun:b'] },
      { urls: ['turn:t1', 'turn:t2'], username: 'u', credential: 'c' },
    ]);
  });
});
