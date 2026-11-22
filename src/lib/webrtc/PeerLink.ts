import { LIMITS } from '@shared/constants';
import type { RtcSignalData } from '@shared/protocol';
import { getRtcConfiguration } from './iceConfig';

export type PeerConnectionFactory = (config: RTCConfiguration) => RTCPeerConnection;

const defaultFactory: PeerConnectionFactory = (config) => new RTCPeerConnection(config);

const DISCONNECT_WAIT_MS = 4000;
const RESTART_WINDOW_MS = 10_000;
const MAX_RESTARTS = 2;
/** Cap for the video sender. Whether the browser applies it is unverified. */
const MAX_VIDEO_BITRATE = 2_500_000;

export interface PeerLinkOptions {
  /** The sharer is impolite, viewers are polite. */
  polite: boolean;
  /** Sends one signal to the remote peer. The owner stamps session and link ids onto it. */
  signal: (data: RtcSignalData) => void;
  config?: RTCConfiguration;
  createPc?: PeerConnectionFactory;
  /** Sharer side: restart ICE on `disconnected` (after 4 s) and `failed`, at most twice. */
  autoRestart?: boolean;
  onState?: (state: RTCPeerConnectionState) => void;
  onTrack?: (stream: MediaStream) => void;
  /** Called when the restart budget is spent. The owner closes the link. */
  onGiveUp?: () => void;
  onError?: (err: unknown) => void;
}

/**
 * One RTCPeerConnection with perfect negotiation. `linkId` identifies this connection pair and is
 * compared by the owner before `handle` is called, so signals for a discarded link never reach it.
 */
export class PeerLink {
  readonly pc: RTCPeerConnection;
  private makingOffer = false;
  private ignoreOffer = false;
  private settingRemoteAnswer = false;
  private pending: (RTCIceCandidateInit | undefined)[] = [];
  private closed = false;
  private restarts = 0;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly linkId: string,
    private readonly opts: PeerLinkOptions,
  ) {
    const pc = (opts.createPc ?? defaultFactory)(opts.config ?? getRtcConfiguration());
    this.pc = pc;
    pc.onnegotiationneeded = () => void this.negotiate();
    pc.onicecandidate = (ev) => this.sendCandidate(ev.candidate);
    pc.onconnectionstatechange = () => this.onConnectionState();
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      opts.onTrack?.(stream);
    };
  }

  get connectionState(): RTCPeerConnectionState {
    return this.pc.connectionState;
  }

  /** Sharer only: sends every track of `stream` to this peer. */
  addStream(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      const sender = this.pc.addTrack(track, stream);
      if (track.kind === 'video') void this.capBitrate(sender);
    }
  }

  private async capBitrate(sender: RTCRtpSender): Promise<void> {
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      params.encodings[0]!.maxBitrate = MAX_VIDEO_BITRATE;
      await sender.setParameters(params);
    } catch (err) {
      this.opts.onError?.(err);
    }
  }

  /** `setLocalDescription()` without arguments, with a createOffer/createAnswer fallback for older browsers. */
  private async setLocal(): Promise<void> {
    const pc = this.pc;
    try {
      await pc.setLocalDescription();
    } catch {
      const desc = pc.signalingState === 'have-remote-offer' ? await pc.createAnswer() : await pc.createOffer();
      await pc.setLocalDescription(desc);
    }
  }

  private sendLocalDescription(): void {
    const d = this.pc.localDescription;
    if (!d || (d.type !== 'offer' && d.type !== 'answer')) return;
    this.opts.signal({ t: 'description', description: { type: d.type, sdp: d.sdp } });
  }

  private async negotiate(): Promise<void> {
    if (this.closed) return;
    try {
      this.makingOffer = true;
      await this.setLocal();
      if (!this.closed) this.sendLocalDescription();
    } catch (err) {
      this.opts.onError?.(err);
    } finally {
      this.makingOffer = false;
    }
  }

  private sendCandidate(candidate: RTCIceCandidate | null): void {
    if (this.closed) return;
    if (!candidate) return this.opts.signal({ t: 'candidate', candidate: null });
    const c = candidate.toJSON();
    if (typeof c.candidate !== 'string') return;
    // The server drops anything over these caps, so do not send it.
    if (c.candidate.length > LIMITS.candidateMax) return;
    if ((c.sdpMid?.length ?? 0) > LIMITS.candidateFieldMax) return;
    if ((c.usernameFragment?.length ?? 0) > LIMITS.candidateFieldMax) return;
    this.opts.signal({
      t: 'candidate',
      candidate: {
        candidate: c.candidate,
        ...(c.sdpMid !== undefined ? { sdpMid: c.sdpMid } : {}),
        ...(c.sdpMLineIndex !== undefined ? { sdpMLineIndex: c.sdpMLineIndex } : {}),
        ...(c.usernameFragment !== undefined ? { usernameFragment: c.usernameFragment } : {}),
      },
    });
  }

  /** Applies one inbound description or candidate. Errors are reported through `onError`, never thrown. */
  async handle(data: RtcSignalData): Promise<void> {
    if (this.closed) return;
    const pc = this.pc;
    try {
      if (data.t === 'description') {
        const d = data.description;
        const readyForOffer = !this.makingOffer && (pc.signalingState === 'stable' || this.settingRemoteAnswer);
        const collision = d.type === 'offer' && !readyForOffer;
        this.ignoreOffer = !this.opts.polite && collision;
        if (this.ignoreOffer) return;
        this.settingRemoteAnswer = d.type === 'answer';
        await pc.setRemoteDescription(d);
        this.settingRemoteAnswer = false;
        await this.flushCandidates();
        if (d.type === 'offer' && !this.closed) {
          await this.setLocal();
          if (!this.closed) this.sendLocalDescription();
        }
      } else if (data.t === 'candidate') {
        if (!pc.remoteDescription) {
          this.pending.push(data.candidate ?? undefined);
          return;
        }
        await this.addCandidate(data.candidate ?? undefined);
      }
    } catch (err) {
      this.settingRemoteAnswer = false;
      this.opts.onError?.(err);
    }
  }

  private async addCandidate(candidate: RTCIceCandidateInit | undefined): Promise<void> {
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (err) {
      if (!this.ignoreOffer) this.opts.onError?.(err);
    }
  }

  private async flushCandidates(): Promise<void> {
    const queued = this.pending;
    this.pending = [];
    for (const c of queued) await this.addCandidate(c);
  }

  private onConnectionState(): void {
    if (this.closed) return;
    const state = this.pc.connectionState;
    this.opts.onState?.(state);
    if (!this.opts.autoRestart) return;
    if (state === 'connected') {
      this.clearTimers();
    } else if (state === 'disconnected') {
      this.disconnectTimer ??= setTimeout(() => this.restartIce(), DISCONNECT_WAIT_MS);
    } else if (state === 'failed') {
      this.restartIce();
    }
  }

  /** Restarts ICE inside this link (same `linkId`). Gives up after two restarts. */
  restartIce(): void {
    if (this.closed) return;
    this.clearTimers();
    if (this.restarts >= MAX_RESTARTS || typeof this.pc.restartIce !== 'function') {
      this.opts.onGiveUp?.();
      return;
    }
    this.restarts++;
    this.pc.restartIce();
    this.restartTimer = setTimeout(() => {
      if (!this.closed && this.pc.connectionState !== 'connected') this.restartIce();
    }, RESTART_WINDOW_MS);
  }

  private clearTimers(): void {
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.disconnectTimer = null;
    this.restartTimer = null;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    this.pending = [];
    const pc = this.pc;
    pc.onnegotiationneeded = null;
    pc.onicecandidate = null;
    pc.onconnectionstatechange = null;
    pc.ontrack = null;
    try {
      pc.close();
    } catch {
      /* already closed */
    }
  }
}
