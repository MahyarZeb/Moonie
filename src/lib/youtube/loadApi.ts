import type { YTNamespace } from './types';

const API_SRC = 'https://www.youtube.com/iframe_api';
const TIMEOUT_MS = 10_000;

let pending: Promise<YTNamespace> | null = null;

/** Loads the official IFrame API once per page. A failure clears the cache so Retry can try again. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === 'undefined') return Promise.reject(new Error('YouTube needs a browser'));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (pending) return pending;

  pending = new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => fail(new Error('Timed out loading the YouTube player')), TIMEOUT_MS);
    const fail = (err: Error) => {
      clearTimeout(timer);
      pending = null;
      document.querySelector(`script[src="${API_SRC}"]`)?.remove();
      reject(err);
    };
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      clearTimeout(timer);
      if (window.YT?.Player) resolve(window.YT);
      else fail(new Error('YouTube player is unavailable'));
    };
    const script = document.createElement('script');
    script.src = API_SRC;
    script.async = true;
    script.onerror = () => fail(new Error('Could not reach YouTube'));
    document.head.appendChild(script);
  });
  return pending;
}
