type CapturableVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

/** Whether this browser can capture a media element. Safari is limited or unsupported. */
export function supportsCaptureStream(): boolean {
  if (typeof HTMLMediaElement === 'undefined') return false;
  const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
  return typeof proto.captureStream === 'function' || typeof proto.mozCaptureStream === 'function';
}

export type CaptureFileResult =
  | { ok: true; stream: MediaStream; hasAudio: boolean }
  | { ok: false; message: string };

const NO_STREAM = "Your browser couldn't stream that file directly, so everyone picks the same file instead.";

/**
 * Captures a playing/ready `<video>` element. Tracks can appear late (after playback starts), so this
 * waits up to `waitMs` for a video track before giving up.
 */
export async function captureFileStream(video: HTMLVideoElement, waitMs = 2000): Promise<CaptureFileResult> {
  const el = video as CapturableVideo;
  let stream: MediaStream | undefined;
  try {
    stream = el.captureStream?.() ?? el.mozCaptureStream?.();
  } catch {
    stream = undefined;
  }
  if (!stream) return { ok: false, message: NO_STREAM };
  const captured = stream;
  if (captured.getVideoTracks().length === 0) {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        captured.removeEventListener('addtrack', onAdd);
        resolve();
      };
      const onAdd = () => {
        if (captured.getVideoTracks().length > 0) done();
      };
      const timer = setTimeout(done, waitMs);
      captured.addEventListener('addtrack', onAdd);
    });
  }
  if (captured.getVideoTracks().length === 0) {
    for (const t of captured.getTracks()) t.stop();
    return { ok: false, message: NO_STREAM };
  }
  return { ok: true, stream: captured, hasAudio: captured.getAudioTracks().length > 0 };
}
