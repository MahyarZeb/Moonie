import { VIDEO_ID_RE } from '@shared/constants';

export interface ParsedYouTube {
  videoId: string;
  startSec?: number;
}

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
]);

/** Parses `90`, `90s`, `1m30s`, `1h2m3s`. Returns undefined for anything else or for 0. */
export function parseStartTime(raw: string | null): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw) || undefined;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
  const total = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return total > 0 ? total : undefined;
}

function withStart(videoId: string, url: URL): ParsedYouTube {
  const startSec = parseStartTime(url.searchParams.get('t') ?? url.searchParams.get('start'));
  return startSec ? { videoId, startSec } : { videoId };
}

/** Extracts a video id (and optional start time) from the YouTube URL forms Moonie supports. */
export function parseYouTubeUrl(input: string): ParsedYouTube | null {
  const text = input.trim();
  if (!text) return null;
  if (VIDEO_ID_RE.test(text)) return { videoId: text };

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  let id: string | undefined;
  if (host === 'youtu.be') id = segments[0];
  else if (segments[0] === 'watch') id = url.searchParams.get('v') ?? undefined;
  else if (['shorts', 'embed', 'live', 'v'].includes(segments[0] ?? '')) id = segments[1];
  return id && VIDEO_ID_RE.test(id) ? withStart(id, url) : null;
}

export const thumbnailUrl = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
