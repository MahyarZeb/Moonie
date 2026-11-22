/** Security headers for every route. Pure so it can be unit tested. */
export interface Header {
  key: string;
  value: string;
}

/** Origin allowed for the signaling WebSocket. Falls back to any wss: host when the URL is unset or invalid. */
function signalingSources(signalingUrl: string | undefined, dev: boolean): string[] {
  const sources: string[] = [];
  if (signalingUrl) {
    try {
      const u = new URL(signalingUrl);
      if (u.protocol === 'ws:' || u.protocol === 'wss:') {
        const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
        if (dev || u.protocol === 'wss:' || loopback) sources.push(`${u.protocol}//${u.host}`);
      }
    } catch {
      /* ignore invalid URL, the generic fallback below applies */
    }
  }
  if (sources.length === 0) sources.push('wss:');
  return sources;
}

export function buildCsp({ dev, signalingUrl }: { dev: boolean; signalingUrl?: string }): string {
  const scriptSrc = ["'self'", "'unsafe-inline'", 'https://www.youtube.com', 'https://s.ytimg.com'];
  const connectSrc = ["'self'", 'https://www.youtube.com', ...signalingSources(signalingUrl, dev)];
  if (dev) {
    scriptSrc.push("'unsafe-eval'");
    connectSrc.push('ws:', 'http:');
  }
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': scriptSrc,
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https://i.ytimg.com', 'https://img.youtube.com'],
    'media-src': ["'self'", 'blob:', 'mediastream:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': connectSrc,
    'frame-src': ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

export function securityHeaders({ dev, signalingUrl }: { dev: boolean; signalingUrl?: string }): Header[] {
  return [
    { key: 'Content-Security-Policy', value: buildCsp({ dev, signalingUrl }) },
    { key: 'Permissions-Policy', value: 'display-capture=(self), camera=(), microphone=(), geolocation=()' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  ];
}
