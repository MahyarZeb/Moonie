import type { ServerMessage } from '@shared/protocol';
import type { SignalingTransport } from '@/lib/signaling/types';
import { PeerLink, type PeerConnectionFactory } from './PeerLink';

export type ViewerState = 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface ViewerDeps {
  transport: SignalingTransport;
  sharerId: string;
  sessionId: string;
  onStream: (stream: MediaStream) => void;
  onState: (state: ViewerState) => void;
  createPc?: PeerConnectionFactory;
  config?: RTCConfiguration;
  newLinkId?: () => string;
}

const CONNECT_TIMEOUT_MS = 15_000;

/** 32 chars from a UUID with the dashes removed. */
export function randomLinkId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * Viewer side of a screen share. Owns exactly one PeerLink at a time. Every `viewer-ready`
 * (initial or retry) gets a brand new link and `linkId`, because a connection cannot be reused after
 * its remote DTLS fingerprint changes. Signals for any other `linkId` are dropped.
 */
export class ShareViewer {
  private link: PeerLink | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private autoRetries = 0;
  private disposed = false;
  private off: (() => void) | null = null;
  private current: ViewerState = 'connecting';

  constructor(private readonly deps: ViewerDeps) {}

  get state(): ViewerState {
    return this.current;
  }

  get linkId(): string | null {
    return this.link?.linkId ?? null;
  }

  start(): void {
    this.off = this.deps.transport.onMessage(this.onMessage);
    this.begin('initial');
  }

  /** Manual "Try again" after the automatic retry gave up. */
  retry(): void {
    if (this.disposed) return;
    this.autoRetries = 0;
    this.begin('retry');
  }

  dispose(): void {
    this.disposed = true;
    this.off?.();
    this.off = null;
    this.clearTimer();
    this.link?.close();
    this.link = null;
  }

  private setState(state: ViewerState): void {
    if (this.current === state) return;
    this.current = state;
    this.deps.onState(state);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Closes any previous link, creates a fresh one, and only then announces it to the sharer. */
  private begin(reason: 'initial' | 'retry'): void {
    if (this.disposed) return;
    const { transport, sharerId, sessionId } = this.deps;
    this.link?.close();
    this.clearTimer();
    const linkId = (this.deps.newLinkId ?? randomLinkId)();
    const link: PeerLink = new PeerLink(linkId, {
      polite: true,
      createPc: this.deps.createPc,
      config: this.deps.config,
      signal: (data) => transport.sendSignal(sharerId, sessionId, linkId, data),
      onTrack: (stream) => this.deps.onStream(stream),
      onState: (pcState) => {
        if (this.link !== link) return;
        if (pcState === 'connected') {
          this.clearTimer();
          this.setState('connected');
        } else if (pcState === 'failed') {
          this.giveUpOnLink();
        }
      },
    });
    this.link = link;
    this.setState(reason === 'retry' ? 'reconnecting' : 'connecting');
    transport.sendSignal(sharerId, sessionId, linkId, { t: 'viewer-ready', reason });
    this.timer = setTimeout(() => this.giveUpOnLink(), CONNECT_TIMEOUT_MS);
  }

  /** One automatic retry with a new link, then a manual "Try again". */
  private giveUpOnLink(): void {
    this.clearTimer();
    if (this.autoRetries < 1) {
      this.autoRetries++;
      this.begin('retry');
      return;
    }
    this.link?.close();
    this.link = null;
    this.setState('failed');
  }

  private onMessage = (msg: ServerMessage): void => {
    if (msg.type !== 'rtc:signal') return;
    if (msg.from !== this.deps.sharerId || msg.sessionId !== this.deps.sessionId) return;
    if (msg.data.t === 'viewer-ready') return; // only the sharer receives these
    if (!this.link || msg.linkId !== this.link.linkId) return; // stale link
    void this.link.handle(msg.data);
  };
}
