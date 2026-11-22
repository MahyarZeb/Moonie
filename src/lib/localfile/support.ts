export const ACCEPT = 'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v';

const EXT_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

/** The file's MIME type, inferred from the extension when the browser leaves `file.type` empty (common for .mov). */
export function inferMime(name: string, type: string): string {
  if (type.startsWith('video/')) return type;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? '';
}

export type FileCheck = { ok: true; mime: string } | { ok: false; message: string };

interface CanPlay {
  canPlayType(type: string): string;
}

/**
 * Checks that the file looks like a video this browser can play.
 * `video` is injectable so the check can be tested without a DOM.
 */
export function checkPlayable(file: { name: string; type: string }, video?: CanPlay): FileCheck {
  const mime = inferMime(file.name, file.type);
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!mime) return { ok: false, message: 'That doesn\'t look like a video. Try an MP4 or WebM file.' };
  const probe = video ?? (typeof document !== 'undefined' ? document.createElement('video') : null);
  if (probe && probe.canPlayType(mime) === '') {
    const label = ext ? `.${ext}` : 'that kind of';
    return { ok: false, message: `This browser can't play ${label} files. Try MP4 or WebM.` };
  }
  return { ok: true, mime };
}

/** "1.4 GB", "820 MB", "12 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
