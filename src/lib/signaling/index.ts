import { loadIdentity } from '@/lib/identity/identity';
import { getSignalingUrl, isMixedContent } from './config';
import type { SignalingTransport } from './types';
import { WebSocketTransport } from './WebSocketTransport';

export * from './types';
export { getSignalingUrl, isMixedContent, parseSignalingUrl } from './config';
export { WebSocketTransport } from './WebSocketTransport';

let instance: SignalingTransport | null = null;

/** Lazily creates the single per-tab transport. Never call this at import time. */
export function getTransport(): SignalingTransport {
  if (!instance) {
    const url = getSignalingUrl();
    if (typeof window !== 'undefined' && isMixedContent(url, window.location.protocol)) {
      console.warn('Moonie: NEXT_PUBLIC_SIGNALING_URL uses ws:// on an https page. Browsers block this; use wss://.');
    }
    instance = new WebSocketTransport({
      url,
      getProfile: loadIdentity,
    });
  }
  return instance;
}
