'use client';

import { useEffect, useState } from 'react';

const cache = new Map<string, string | null>();

/** Looks up a title through YouTube's oEmbed endpoint. Returns null when unavailable (blocked, offline, CORS). */
async function fetchTitle(videoId: string): Promise<string | null> {
  if (cache.has(videoId)) return cache.get(videoId) ?? null;
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { title?: unknown };
    const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : null;
    cache.set(videoId, title);
    return title;
  } catch {
    cache.set(videoId, null);
    return null;
  }
}

/** A video title: the known one if given, else a lazy lookup, else "YouTube video (ID)". */
export function useVideoTitle(videoId: string, known?: string): string {
  const [looked, setLooked] = useState<{ id: string; title: string } | null>(null);
  useEffect(() => {
    if (known) return;
    let cancelled = false;
    void fetchTitle(videoId).then((title) => {
      if (!cancelled && title) setLooked({ id: videoId, title });
    });
    return () => {
      cancelled = true;
    };
  }, [videoId, known]);
  if (known) return known;
  return looked?.id === videoId ? looked.title : `YouTube video (${videoId})`;
}
