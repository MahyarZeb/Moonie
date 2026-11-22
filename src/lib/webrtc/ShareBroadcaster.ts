import type { MediaState, ServerMessage } from '@shared/protocol';
import type { RoomStore } from '@/lib/room/roomStore';
import { TransportError, type SignalingTransport } from '@/lib/signaling/types';
import { startDisplayCapture, type CaptureFailure, type CaptureResult } from './capture';
import { PeerLink, type PeerConnectionFactory } from './PeerLink';

export type BroadcastStatus = 'idle' | 'starting' | 'sharing';

export interface BroadcastState {
  status: BroadcastStatus;
  /** The captured stream, for the sharer's own preview. */
  stream: MediaStream | null;
  hasAudio: boolean;
  /** viewerId -> connection state of that viewer's link. */
  links: Record<string, RTCPeerConnectionState>;
  error: { reason: CaptureFailure; message: string } | null;
}

export interface BroadcasterDeps {
  transport: SignalingTransport;
  store: RoomStore;
  capture?: () => Promise<CaptureResult>;
  createPc?: PeerConnectionFactory;
  config?: RTCConfiguration;
  /** Called after a teardown that was not started by the user's own Stop. */
  onEnded?: (message: string) => void;
}

const IDLE: BroadcastState = { status: 'idle', stream: null, hasAudio: false, links: {}, error: null };

const FRIENDLY: Partial<Record<string, string>> = {
  not_host: 'Only the host can share.',
  invalid_state: 'Someone is already sharing.',
  timeout: 'The server took too long to answer.',
  network: 'You are not connected right now.',
};

function isOwnShare(media: MediaState | null | undefined, sessionId: string): boolean {
  if (!media) return false;
  if (media.kind === 'screen') return media.sessionId === sessionId;
  return media.kind === 'local' && media.delivery === 'stream' && media.sessionId === sessionId;
}

/**
 * Host side of a screen share: captures the screen, asks the server to start the session, and keeps
 * one PeerLink per viewer. The room store is the source of truth: when it stops showing this session
 * (stop, media change, host change, socket drop, kick, room closed) everything is torn down.
 */
export class ShareBroadcaster {
  private state: BroadcastState = IDLE;
  private listeners = new Set<() => void>();
  private stream: MediaStream | null = null;
  private sessionId: string | null = null;
  private seenOwn = false;
  private seq = 0;
  private links = new Map<string, { linkId: string; link: PeerLink }>();
  private offStore: (() => void) | null = null;
  private offMessage: (() => void) | null = null;

  constructor(private readonly deps: BroadcasterDeps) {}

  getState = (): BroadcastState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setState(patch: Partial<BroadcastState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }

  /** Captures the screen and starts a share. Must be called from a click. Errors land in `state.error`. */
  async start(): Promise<void> {
    if (this.state.status !== 'idle') return;
    const token = ++this.seq;
    this.setState({ status: 'starting', error: null });
    const cap = await (this.deps.capture ?? startDisplayCapture)();
    if (!cap.ok) {
      this.setState({ status: 'idle', error: { reason: cap.reason, message: cap.message } });
      return;
    }
    this.stream = cap.stream;
    this.setState({ stream: cap.stream, hasAudio: cap.hasAudio });
    const video = cap.stream.getVideoTracks()[0];
    if (video) {
      try {
        video.contentHint = 'detail';
      } catch {
        /* optional */
      }
      video.addEventListener('ended', this.onTrackEnded);
    }

    let media: MediaState | null = null;
    let failure: string | null = null;
    try {
      const reply = await this.deps.transport.request({ type: 'share:start', source: 'screen', hasAudio: cap.hasAudio });
      media = reply.type === 'media:state' ? reply.media : null;
      if (media?.kind !== 'screen') failure = 'The server did not start the share.';
    } catch (err) {
      failure = err instanceof TransportError ? (FRIENDLY[err.code] ?? err.message) : 'Something went wrong.';
    }

    if (token !== this.seq) {
      // The user stopped (or the room ended) while the request was in flight.
      if (!failure) this.deps.transport.send({ type: 'share:stop' });
      return;
    }
    if (failure || media?.kind !== 'screen') {
      this.releaseStream();
      this.setState({ ...IDLE, error: { reason: 'rejected', message: `Couldn't start sharing: ${failure ?? 'unknown error'}` } });
      return;
    }

    this.sessionId = media.sessionId;
    this.seenOwn = false;
    this.setState({ status: 'sharing' });
    this.offStore = this.deps.store.subscribe(this.checkStore);
    this.offMessage = this.deps.transport.onMessage(this.onMessage);
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', this.onUnload);
    this.checkStore();
  }

  /** The user's own Stop button. Tells the server, then tears down. */
  stop(): void {
    const hadSession = this.sessionId !== null;
    this.seq++;
    this.teardown();
    if (hadSession) this.deps.transport.send({ type: 'share:stop' });
  }

  /** Stops capture without telling the server. Used on unmount and room teardown. */
  dispose(): void {
    this.seq++;
    this.teardown();
  }

  private onTrackEnded = (): void => {
    this.stop();
  };

  private onUnload = (): void => {
    this.releaseStream();
  };

  private checkStore = (): void => {
    const sid = this.sessionId;
    if (!sid) return;
    const s = this.deps.store.getState();
    if (isOwnShare(s.snapshot?.media, sid)) {
      this.seenOwn = true;
      this.pruneLinks();
      return;
    }
    if (!this.seenOwn) return;
    const stillHost = !!s.snapshot && s.snapshot.hostId === s.selfId;
    this.teardown(!s.snapshot || stillHost ? 'Screen sharing ended' : 'Screen sharing ended because someone else is host now');
  };

  private pruneLinks(): void {
    const present = new Set(this.deps.store.getState().snapshot?.participants.map((p) => p.id));
    let changed = false;
    for (const [id, entry] of this.links) {
      if (present.has(id)) continue;
      entry.link.close();
      this.links.delete(id);
      changed = true;
    }
    if (changed) this.publishLinks();
  }

  private onMessage = (msg: ServerMessage): void => {
    if (msg.type !== 'rtc:signal' || msg.sessionId !== this.sessionId) return;
    const existing = this.links.get(msg.from);
    if (msg.data.t === 'viewer-ready') {
      if (existing?.linkId === msg.linkId) return; // repeat of the current link
      if (!this.deps.store.getState().snapshot?.participants.some((p) => p.id === msg.from)) return;
      existing?.link.close();
      this.links.delete(msg.from);
      this.openLink(msg.from, msg.linkId);
      return;
    }
    // Late candidates and answers from a discarded link carry an old linkId.
    if (existing?.linkId === msg.linkId) void existing.link.handle(msg.data);
  };

  private openLink(viewerId: string, linkId: string): void {
    const sessionId = this.sessionId;
    if (!sessionId || !this.stream) return;
    const link: PeerLink = new PeerLink(linkId, {
      polite: false,
      autoRestart: true,
      createPc: this.deps.createPc,
      config: this.deps.config,
      signal: (data) => this.deps.transport.sendSignal(viewerId, sessionId, linkId, data),
      onState: () => this.publishLinks(),
      onGiveUp: () => {
        if (this.links.get(viewerId)?.link !== link) return;
        link.close();
        this.links.delete(viewerId);
        this.publishLinks();
      },
    });
    this.links.set(viewerId, { linkId, link });
    link.addStream(this.stream);
    this.publishLinks();
  }

  private publishLinks(): void {
    const links: Record<string, RTCPeerConnectionState> = {};
    for (const [id, entry] of this.links) links[id] = entry.link.connectionState;
    this.setState({ links });
  }

  private releaseStream(): void {
    const stream = this.stream;
    this.stream = null;
    if (!stream) return;
    for (const track of stream.getTracks()) {
      track.removeEventListener('ended', this.onTrackEnded);
      track.stop();
    }
  }

  private teardown(message?: string): void {
    const active = this.state.status !== 'idle' || this.stream !== null || this.links.size > 0;
    this.offStore?.();
    this.offMessage?.();
    this.offStore = null;
    this.offMessage = null;
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', this.onUnload);
    for (const entry of this.links.values()) entry.link.close();
    this.links.clear();
    this.releaseStream();
    this.sessionId = null;
    this.seenOwn = false;
    if (active) this.setState({ ...IDLE });
    if (active && message) this.deps.onEnded?.(message);
  }
}
