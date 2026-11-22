import type { LocalFileMeta } from '@shared/protocol';
import { quickHash } from './hash';
import { checkPlayable, type FileCheck } from './support';

export type LocalFileStatus = 'idle' | 'checking' | 'ready' | 'error';

export interface LocalFileState {
  status: LocalFileStatus;
  file: File | null;
  /** Object URL for this tab's own `<video>`. Never sent to anyone. */
  url: string | null;
  meta: LocalFileMeta | null;
  error: string | null;
}

export interface LocalFileDeps {
  createUrl?: (file: File) => string;
  revokeUrl?: (url: string) => void;
  /** Resolves the duration in seconds, rejects when the browser cannot decode the file. */
  readDuration?: (url: string) => Promise<number>;
  hash?: (file: File) => Promise<string | undefined>;
  check?: (file: File) => FileCheck;
}

const IDLE: LocalFileState = { status: 'idle', file: null, url: null, meta: null, error: null };

function readDurationFromElement(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const d = video.duration;
      cleanup();
      resolve(Number.isFinite(d) ? d : 0);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('decode'));
    };
    video.src = url;
  });
}

/**
 * This tab's chosen local video file. It lives next to the room controller so the file survives tab
 * switches. Holds the object URL (local only), the metadata that is sent to the room, and the
 * `<video>` element that is currently showing the file (needed for `captureStream`).
 */
export class LocalFileStore {
  private state: LocalFileState = IDLE;
  private listeners = new Set<() => void>();
  private seq = 0;
  private element: HTMLVideoElement | null = null;

  constructor(private readonly deps: LocalFileDeps = {}) {}

  getState = (): LocalFileState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: LocalFileState): void {
    this.state = next;
    for (const l of [...this.listeners]) l();
  }

  /** The `<video>` that currently plays the file, registered by `LocalPlayer`. */
  setElement(el: HTMLVideoElement | null): void {
    this.element = el;
  }

  getElement(): HTMLVideoElement | null {
    return this.element;
  }

  private revoke(url: string | null): void {
    if (url) (this.deps.revokeUrl ?? ((u: string) => URL.revokeObjectURL(u)))(url);
  }

  /** Validates, probes and fingerprints a picked file. Newer picks win over older ones still in flight. */
  async pick(file: File): Promise<void> {
    const token = ++this.seq;
    this.revoke(this.state.url);
    this.set({ ...IDLE, status: 'checking', file });

    const check = (this.deps.check ?? ((f: File) => checkPlayable(f)))(file);
    if (!check.ok) {
      this.set({ ...IDLE, status: 'error', error: check.message });
      return;
    }
    const url = (this.deps.createUrl ?? ((f: File) => URL.createObjectURL(f)))(file);
    let durationSec: number;
    try {
      durationSec = await (this.deps.readDuration ?? readDurationFromElement)(url);
    } catch {
      this.revoke(url);
      if (token === this.seq) {
        this.set({ ...IDLE, status: 'error', error: "This browser couldn't open that video. Try an MP4 or WebM file." });
      }
      return;
    }
    const hash = await (this.deps.hash ?? quickHash)(file).catch(() => undefined);
    if (token !== this.seq) {
      this.revoke(url);
      return;
    }
    const meta: LocalFileMeta = {
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      mime: check.mime,
      ...(durationSec > 0 ? { durationSec } : {}),
      ...(hash ? { hash } : {}),
    };
    this.set({ status: 'ready', file, url, meta, error: null });
  }

  clear(): void {
    this.seq++;
    this.revoke(this.state.url);
    this.element = null;
    this.set(IDLE);
  }

  dispose(): void {
    this.clear();
    this.listeners.clear();
  }
}
