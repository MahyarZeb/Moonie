import { CLOSE_IDLE, CLOSE_KICKED, CLOSE_REPLACED } from '@shared/constants';
import { estimateOffset, sampleFromPong, type ClockSample } from '@shared/clock';
import type {
  AvatarId,
  ClientMessage,
  CreateRoomInput,
  JoinedPayload,
  JoinRoomInput,
  RoomPeek,
  RtcSignalData,
  ServerMessage,
} from '@shared/protocol';
import {
  TransportError,
  type ConnectionStatus,
  type SignalingTransport,
  type StatusInfo,
  type Unsubscribe,
} from './types';

/** The subset of the browser WebSocket the transport uses. Tests pass a fake. */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface TransportOptions {
  /** Signaling URL (ws:// or wss://). Null or invalid makes connect() fail with a configuration error. */
  url: string | null;
  createSocket?: (url: string) => WebSocketLike;
  /** Name and avatar sent with a resume `room:join`. */
  getProfile?: () => { displayName: string; avatar: AvatarId } | null;
  random?: () => number;
}

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_FAILED_ATTEMPTS = 8;
const NO_RECONNECT_CODES = new Set([CLOSE_IDLE, CLOSE_REPLACED, CLOSE_KICKED]);
const TOAST_COALESCE_MS = 5000;
const PING_VISIBLE_MS = 5000;
const PING_HIDDEN_MS = 30_000;

interface Pending {
  resolve: (msg: ServerMessage) => void;
  reject: (err: TransportError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class WebSocketTransport implements SignalingTransport {
  status: ConnectionStatus = 'idle';

  private ws: WebSocketLike | null = null;
  private readonly messageHandlers = new Set<(msg: ServerMessage) => void>();
  private readonly statusHandlers = new Set<(s: ConnectionStatus, info?: StatusInfo) => void>();
  private readonly errorHandlers = new Set<(message: string) => void>();
  private readonly pending = new Map<string, Pending>();
  private refCounter = 0;
  private attempt = 0;
  private joined: { code: string; resumeToken: string } | null = null;
  private intentionalClose = false;
  private connectPromise: Promise<void> | null = null;
  private connectSettle: { resolve: () => void; reject: (e: TransportError) => void } | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pingSent = new Map<number, number>();
  private samples: ClockSample[] = [];
  private offsetMs = 0;
  private lastRateLimitNotice = 0;
  private lastDropNotice = -Infinity;
  private visibilityBound = false;

  constructor(private readonly opts: TransportOptions) {}

  // ------------------------------------------------------------- connection

  connect(): Promise<void> {
    if (this.status === 'open') return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    if (this.status === 'reconnecting') {
      // An automatic retry is already running; wait for its outcome instead of opening a second socket.
      return new Promise<void>((resolve, reject) => {
        const off = this.onStatus((s) => {
          if (s === 'open') resolve();
          else if (s === 'failed' || s === 'closed') reject(new TransportError('network', 'Could not reconnect'));
          else return;
          off();
        });
      });
    }
    this.intentionalClose = false;
    this.clearReconnectTimer();
    const promise = new Promise<void>((resolve, reject) => {
      this.connectSettle = { resolve, reject };
    });
    this.connectPromise = promise;
    this.openSocket(false);
    return promise;
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.joined = null;
    this.clearReconnectTimer();
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    this.failPending(new TransportError('network', 'Disconnected'));
    if (this.connectSettle) {
      this.connectSettle.reject(new TransportError('network', 'Disconnected'));
      this.connectSettle = null;
      this.connectPromise = null;
    }
    try {
      ws?.close(1000, 'client disconnect');
    } catch {
      /* already closed */
    }
    this.setStatus('closed', { attempt: this.attempt });
  }

  reconnect(): void {
    if (this.status === 'open' || this.status === 'connecting') return;
    this.clearReconnectTimer();
    this.attempt = 0;
    this.intentionalClose = false;
    this.openSocket(true);
  }

  private openSocket(isReconnect: boolean): void {
    const url = this.opts.url;
    if (!url) {
      this.setStatus('failed', { attempt: this.attempt });
      this.settleConnect(new TransportError('network', 'Signaling server is not configured'));
      return;
    }
    this.setStatus(isReconnect ? 'reconnecting' : 'connecting', { attempt: this.attempt });
    let ws: WebSocketLike;
    try {
      ws = this.opts.createSocket ? this.opts.createSocket(url) : (new WebSocket(url) as unknown as WebSocketLike);
    } catch {
      this.handleFailedAttempt(isReconnect);
      return;
    }
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      if (ws !== this.ws) return;
      opened = true;
      this.attempt = 0;
      this.setStatus('open', { attempt: 0 });
      this.settleConnect();
      if (this.joined) void this.resume();
    };
    ws.onmessage = (ev) => {
      if (ws === this.ws && typeof ev.data === 'string') this.handleMessage(ev.data);
    };
    ws.onerror = () => {
      /* the close event that follows carries the outcome */
    };
    ws.onclose = (ev) => {
      if (ws !== this.ws) return;
      this.ws = null;
      this.stopPing();
      this.failPending(new TransportError('network', 'Connection lost'));
      if (this.intentionalClose) return;
      if (!opened) return this.handleFailedAttempt(isReconnect);
      if (NO_RECONNECT_CODES.has(ev.code) || !this.joined) {
        this.setStatus('closed', { attempt: 0, closeCode: ev.code });
        return;
      }
      this.attempt = 0;
      this.scheduleReconnect();
    };
  }

  private handleFailedAttempt(isReconnect: boolean): void {
    if (!isReconnect) {
      this.setStatus('failed', { attempt: this.attempt });
      this.settleConnect(new TransportError('network', 'Could not reach the signaling server'));
      return;
    }
    this.attempt += 1;
    if (this.attempt >= MAX_FAILED_ATTEMPTS) {
      this.setStatus('failed', { attempt: this.attempt });
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const random = this.opts.random ?? Math.random;
    const base = Math.min(8000, 500 * 2 ** this.attempt);
    const delay = Math.round(base * (1 + (random() * 0.4 - 0.2)));
    this.setStatus('reconnecting', { attempt: this.attempt + 1, nextRetryMs: delay });
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket(true);
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private settleConnect(err?: TransportError): void {
    const settle = this.connectSettle;
    this.connectSettle = null;
    this.connectPromise = null;
    if (!settle) return;
    if (err) settle.reject(err);
    else settle.resolve();
  }

  private setStatus(status: ConnectionStatus, info?: StatusInfo): void {
    const changed = this.status !== status;
    this.status = status;
    if (!changed && status !== 'reconnecting') return;
    for (const h of [...this.statusHandlers]) h(status, info);
  }

  private async ensureOpen(): Promise<void> {
    if (this.status === 'open') return;
    await this.connect();
  }

  /** Resume only. A rejected resume is reported as an expired room and never becomes a fresh join. */
  private async resume(): Promise<void> {
    const joined = this.joined;
    const profile = this.opts.getProfile?.() ?? null;
    if (!joined) return;
    if (!profile) {
      this.joined = null;
      this.emit({ type: 'room:closed', reason: 'expired' });
      return;
    }
    try {
      await this.request({ type: 'room:join', code: joined.code, resumeToken: joined.resumeToken, ...profile });
    } catch (err) {
      if (err instanceof TransportError && err.code === 'invalid_state') return; // already joined on this socket
      this.joined = null;
      this.emit({ type: 'room:closed', reason: 'expired' });
    }
  }

  // --------------------------------------------------------------- messages

  private handleMessage(data: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'sync:pong') return this.onPong(msg.t0, msg.serverTime);

    const ref = 'ref' in msg && typeof msg.ref === 'string' ? msg.ref : undefined;
    if (msg.type === 'error') {
      const waiting = ref ? this.pending.get(ref) : undefined;
      if (ref && waiting) {
        clearTimeout(waiting.timer);
        this.pending.delete(ref);
        waiting.reject(new TransportError(msg.code, msg.message));
        return;
      }
      if (msg.code === 'stale') return;
      if (msg.code === 'rate_limited') {
        const now = Date.now();
        if (now - this.lastRateLimitNotice < TOAST_COALESCE_MS) return;
        this.lastRateLimitNotice = now;
      }
      this.emit(msg);
      return;
    }

    if (msg.type === 'room:joined') {
      this.joined = { code: msg.snapshot.code, resumeToken: msg.resumeToken };
      this.startPing();
    } else if (msg.type === 'kicked' || msg.type === 'room:closed') {
      this.joined = null;
      this.stopPing();
    }
    this.emit(msg);
    const waiting = ref ? this.pending.get(ref) : undefined;
    if (ref && waiting) {
      clearTimeout(waiting.timer);
      this.pending.delete(ref);
      waiting.resolve(msg);
    }
  }

  private emit(msg: ServerMessage): void {
    for (const h of [...this.messageHandlers]) {
      try {
        h(msg);
      } catch (err) {
        console.error('Moonie: message handler failed', err);
      }
    }
  }

  private notifyLocalError(message: string): void {
    const now = Date.now();
    if (now - this.lastDropNotice < TOAST_COALESCE_MS) return;
    this.lastDropNotice = now;
    for (const h of [...this.errorHandlers]) h(message);
  }

  private failPending(err: TransportError): void {
    for (const [ref, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(ref);
    }
  }

  // -------------------------------------------------------------- requests

  send(msg: ClientMessage): void {
    if (this.status !== 'open' || !this.ws) {
      this.notifyLocalError('Not connected. Reconnect to keep going.');
      return;
    }
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      this.notifyLocalError('Not connected. Reconnect to keep going.');
    }
  }

  request(msg: ClientMessage): Promise<ServerMessage> {
    if (this.status !== 'open' || !this.ws) {
      return Promise.reject(new TransportError('network', 'Not connected'));
    }
    const ref = `m${++this.refCounter}`;
    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(ref);
        reject(new TransportError('timeout', 'The server took too long to answer'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(ref, { resolve, reject, timer });
      try {
        this.ws?.send(JSON.stringify({ ...msg, ref }));
      } catch {
        clearTimeout(timer);
        this.pending.delete(ref);
        reject(new TransportError('network', 'Not connected'));
      }
    });
  }

  sendSignal(to: string, sessionId: string, linkId: string, data: RtcSignalData): void {
    this.send({ type: 'rtc:signal', to, sessionId, linkId, data });
  }

  async peekRoom(code: string): Promise<RoomPeek> {
    await this.ensureOpen();
    const reply = await this.request({ type: 'room:peek', code });
    if (reply.type !== 'room:info') throw new TransportError('bad_request', 'Unexpected reply');
    return reply.peek;
  }

  async createRoom(input: CreateRoomInput): Promise<JoinedPayload> {
    await this.ensureOpen();
    return this.joinedPayload(await this.request({ type: 'room:create', ...input }));
  }

  async joinRoom(input: JoinRoomInput): Promise<JoinedPayload> {
    await this.ensureOpen();
    return this.joinedPayload(await this.request({ type: 'room:join', ...input }));
  }

  private joinedPayload(reply: ServerMessage): JoinedPayload {
    if (reply.type !== 'room:joined') throw new TransportError('bad_request', 'Unexpected reply');
    return { selfId: reply.selfId, resumeToken: reply.resumeToken, snapshot: reply.snapshot, resumed: reply.resumed };
  }

  leaveRoom(): void {
    if (!this.joined) return;
    this.joined = null;
    this.stopPing();
    if (this.status === 'open' && this.ws) {
      try {
        this.ws.send(JSON.stringify({ type: 'room:leave' } satisfies ClientMessage));
      } catch {
        /* socket closing */
      }
    }
  }

  // ------------------------------------------------------------------ clock

  getClockOffsetMs(): number {
    return this.offsetMs;
  }

  private startPing(): void {
    this.stopPing();
    if (typeof document !== 'undefined' && !this.visibilityBound) {
      document.addEventListener('visibilitychange', this.onVisibility);
      this.visibilityBound = true;
    }
    this.pingOnce();
  }

  private stopPing(): void {
    if (this.pingTimer) clearTimeout(this.pingTimer);
    this.pingTimer = null;
    if (typeof document !== 'undefined' && this.visibilityBound) {
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.visibilityBound = false;
    }
  }

  private onVisibility = (): void => {
    if (document.visibilityState === 'visible' && this.joined) {
      if (this.pingTimer) clearTimeout(this.pingTimer);
      this.pingOnce();
    }
  };

  private pingOnce(): void {
    if (this.status === 'open' && this.ws) {
      const t0 = Date.now();
      this.pingSent.set(t0, performance.now());
      try {
        this.ws.send(JSON.stringify({ type: 'sync:ping', t0 } satisfies ClientMessage));
      } catch {
        /* ignore */
      }
    }
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    this.pingTimer = setTimeout(() => this.pingOnce(), hidden ? PING_HIDDEN_MS : PING_VISIBLE_MS);
  }

  private onPong(t0: number, serverTime: number): void {
    const sent = this.pingSent.get(t0);
    if (sent === undefined) return;
    this.pingSent.delete(t0);
    const rtt = performance.now() - sent;
    this.samples.push(sampleFromPong(t0, serverTime, rtt));
    if (this.samples.length > 12) this.samples.shift();
    this.offsetMs = estimateOffset(this.samples);
  }

  // ----------------------------------------------------------------- events

  onMessage(handler: (msg: ServerMessage) => void): Unsubscribe {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStatus(handler: (s: ConnectionStatus, info?: StatusInfo) => void): Unsubscribe {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  onLocalError(handler: (message: string) => void): Unsubscribe {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }
}
