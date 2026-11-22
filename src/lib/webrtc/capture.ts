import { getScreenShareSupport } from './support';

export type CaptureFailure = 'unsupported' | 'insecure' | 'denied' | 'cancelled' | 'error' | 'rejected';

export type CaptureResult =
  | { ok: true; stream: MediaStream; hasAudio: boolean }
  | { ok: false; reason: Exclude<CaptureFailure, 'rejected'>; message: string };

const MESSAGES: Record<Exclude<CaptureFailure, 'rejected' | 'error'>, string> = {
  unsupported: "Screen sharing isn't available in this browser (most phones can't share their screen). You can still watch!",
  insecure: 'Screen sharing needs a secure (https) page.',
  denied: 'Screen sharing was blocked. Allow it in your browser prompt and try again.',
  cancelled: 'No screen was picked. Try again when you are ready.',
};

/** Maps a getDisplayMedia rejection to a friendly failure. Pure, so it is unit-testable. */
export function mapCaptureError(err: unknown): Extract<CaptureResult, { ok: false }> {
  const name = typeof err === 'object' && err !== null && 'name' in err ? String(err.name) : '';
  if (name === 'NotAllowedError') return { ok: false, reason: 'denied', message: MESSAGES.denied };
  if (name === 'NotFoundError' || name === 'AbortError') return { ok: false, reason: 'cancelled', message: MESSAGES.cancelled };
  const detail = err instanceof Error && err.message ? err.message : 'Unknown error';
  return { ok: false, reason: 'error', message: `Couldn't start screen capture: ${detail}` };
}

/** Asks the browser for a screen, window or tab. Must run from a user gesture. */
export async function startDisplayCapture(): Promise<CaptureResult> {
  const support = getScreenShareSupport();
  if (support !== 'ok') return { ok: false, reason: support, message: MESSAGES[support] };
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
    return { ok: true, stream, hasAudio: stream.getAudioTracks().length > 0 };
  } catch (err) {
    return mapCaptureError(err);
  }
}
