import type { CreateRoomInput, JoinRoomInput } from '@shared/protocol';
import { clearSession, loadIdentity, readSession, saveIdentity, writeSession } from '@/lib/identity/identity';
import { TransportError, type SignalingTransport } from '@/lib/signaling/types';
import { LocalFileStore } from '@/lib/localfile/LocalFileStore';
import { ShareBroadcaster } from '@/lib/webrtc/ShareBroadcaster';
import type { RoomError } from './reducer';
import type { RoomStore } from './roomStore';

function toRoomError(err: unknown): RoomError {
  if (err instanceof TransportError) return { code: err.code, message: err.message };
  return { code: 'network', message: err instanceof Error ? err.message : 'Something went wrong' };
}

/**
 * Non-React owner of the room lifecycle: wires the transport to the store, runs the
 * resume-then-peek flow, and guards against React Strict Mode double effects.
 */
export class RoomController {
  private attemptKey: string | null = null;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;
  private resolved: SignalingTransport | null = null;

  constructor(
    private readonly getTransport: () => SignalingTransport,
    readonly store: RoomStore,
  ) {}

  /** The transport is created on first use, never during server rendering. */
  get transport(): SignalingTransport {
    if (!this.resolved) this.resolved = this.getTransport();
    return this.resolved;
  }

  /** Shows a short info message (the provider wires this to a toast). */
  private notifier: (message: string) => void = () => undefined;

  /** Sets the info-message sink. Returns a function that removes it. */
  setNotifier(fn: (message: string) => void): () => void {
    this.notifier = fn;
    return () => {
      if (this.notifier === fn) this.notifier = () => undefined;
    };
  }

  private broadcaster: ShareBroadcaster | null = null;

  /** The tab's single screen-share broadcaster, created on first use. It outlives the Screen tab. */
  get share(): ShareBroadcaster {
    this.broadcaster ??= new ShareBroadcaster({
      transport: this.transport,
      store: this.store,
      onEnded: (message) => this.notifier(message),
    });
    return this.broadcaster;
  }

  private localFileStore: LocalFileStore | null = null;

  /** This tab's chosen local video file. It lives as long as the room does. */
  get localFile(): LocalFileStore {
    this.localFileStore ??= new LocalFileStore();
    return this.localFileStore;
  }

  /** Subscribes the transport to the store. Returns the cleanup function. */
  start(): () => void {
    const t = this.transport;
    const offMessage = t.onMessage((msg) => {
      if (msg.type === 'room:joined') writeSession({ code: msg.snapshot.code, resumeToken: msg.resumeToken });
      else if (msg.type === 'kicked' || msg.type === 'room:closed') {
        clearSession();
        this.attemptKey = null;
      }
      this.store.dispatch(msg);
    });
    const offStatus = t.onStatus((status, info) =>
      this.store.dispatch({ type: 'connection', status, attempt: info?.attempt, closeCode: info?.closeCode }),
    );
    const offError = t.onLocalError((message) =>
      this.store.dispatch({ type: 'local-error', error: { code: 'network', message } }),
    );
    this.store.dispatch({ type: 'connection', status: t.status });
    return () => {
      offMessage();
      offStatus();
      offError();
    };
  }

  /** Returns false when an attempt for this code is already running (Strict Mode second effect). */
  beginAttempt(code: string): boolean {
    if (this.attemptKey === code) return false;
    this.attemptKey = code;
    return true;
  }

  /** Called from effect cleanup. Deferred so a Strict Mode re-mount can cancel it. */
  scheduleLeave(): void {
    this.cancelPendingLeave();
    this.leaveTimer = setTimeout(() => {
      this.leaveTimer = null;
      this.leave();
    }, 0);
  }

  cancelPendingLeave(): void {
    if (this.leaveTimer) clearTimeout(this.leaveTimer);
    this.leaveTimer = null;
  }

  /** Leaves the current room. A no-op when idle. */
  leave(): void {
    this.cancelPendingLeave();
    const { phase } = this.store.getState();
    if (phase === 'idle') {
      this.attemptKey = null;
      return;
    }
    this.transport.leaveRoom();
    this.localFileStore?.clear();
    clearSession();
    this.attemptKey = null;
    this.store.dispatch({ type: 'reset' });
  }

  /** Opens `/room/CODE`: resume a stored session first, otherwise peek for the lobby. */
  async open(code: string): Promise<void> {
    const s = this.store.getState();
    if (s.phase === 'in-room' && s.snapshot?.code === code) return;
    if (s.phase === 'in-room' || s.phase === 'joining' || s.phase === 'ended') {
      this.leave();
      this.attemptKey = code;
    }
    const session = readSession();
    if (session && session.code === code) {
      const profile = loadIdentity();
      if (profile) {
        this.store.dispatch({ type: 'begin-join', enter: true });
        try {
          await this.transport.joinRoom({ code, resumeToken: session.resumeToken, ...profile });
          return;
        } catch (err) {
          if (err instanceof TransportError && err.code === 'invalid_state') return; // already joined
          clearSession();
          this.store.dispatch({ type: 'reset' });
        }
      } else clearSession();
    } else if (session) clearSession();
    await this.peek(code, true);
  }

  /** Loads the lobby data. `initial` moves the phase from idle to peeking first. */
  async peek(code: string, initial = false): Promise<void> {
    if (initial) this.store.dispatch({ type: 'begin-peek' });
    try {
      await this.transport.peekRoom(code);
    } catch (err) {
      this.store.dispatch({ type: 'peek-failed', error: toRoomError(err) });
    }
  }

  /** Creates a room and resolves with its code. The creator lands in the lobby (`entered: false`). */
  async createRoom(input: CreateRoomInput): Promise<string> {
    saveIdentity({ displayName: input.displayName, avatar: input.avatar });
    this.store.dispatch({ type: 'begin-join', enter: false });
    try {
      const payload = await this.transport.createRoom(input);
      return payload.snapshot.code;
    } catch (err) {
      this.store.dispatch({ type: 'join-failed' });
      throw err;
    }
  }

  /** Joins from the lobby. Success lands directly inside the room. */
  async joinRoom(input: JoinRoomInput): Promise<void> {
    saveIdentity({ displayName: input.displayName, avatar: input.avatar });
    this.store.dispatch({ type: 'begin-join', enter: true });
    try {
      await this.transport.joinRoom(input);
    } catch (err) {
      this.store.dispatch({ type: 'join-failed' });
      throw err;
    }
  }

  enter(): void {
    this.store.dispatch({ type: 'enter' });
  }

  /** Clears local lobby errors and tries again (used by the Retry button). */
  async retry(code: string): Promise<void> {
    if (this.transport.status !== 'open') {
      try {
        await this.transport.connect();
      } catch {
        /* peek reports the failure */
      }
    }
    this.store.dispatch({ type: 'reset' });
    await this.peek(code, true);
  }
}
