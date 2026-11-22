import { describe, expect, it } from 'vitest';
import { buildCsp, securityHeaders } from '../../security-headers';

describe('security headers', () => {
  it('allows YouTube frames and display capture for self', () => {
    const headers = securityHeaders({ dev: false, signalingUrl: 'wss://signal.example.com' });
    const csp = headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    expect(csp).toContain('frame-src https://www.youtube.com https://www.youtube-nocookie.com');
    expect(headers.find((h) => h.key === 'Permissions-Policy')!.value).toContain('display-capture=(self)');
  });

  it('production CSP has no ws:, http: or localhost; dev allows them', () => {
    const prod = buildCsp({ dev: false, signalingUrl: 'wss://signal.example.com' });
    expect(prod).toContain('wss://signal.example.com');
    expect(prod).not.toMatch(/(^|\s)(ws:|http:)/);
    expect(prod).not.toContain('localhost');
    expect(prod).not.toContain('unsafe-eval');
    const dev = buildCsp({ dev: true, signalingUrl: 'ws://localhost:8787' });
    expect(dev).toMatch(/\sws:/);
    expect(dev).toMatch(/\shttp:/);
  });

  it('ignores an insecure ws:// signaling URL in production', () => {
    const prod = buildCsp({ dev: false, signalingUrl: 'ws://localhost:8787' });
    expect(prod).not.toContain('localhost');
    expect(prod).toContain('connect-src');
    expect(prod).toMatch(/\swss:/);
  });
});
