import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import { securityHeaders } from './security-headers';

const nextConfig = (phase: string): NextConfig => ({
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: ['127.0.0.1'],
  async headers() {
    const headers = securityHeaders({
      dev: phase === PHASE_DEVELOPMENT_SERVER,
      signalingUrl: process.env.NEXT_PUBLIC_SIGNALING_URL,
    });
    return [{ source: '/:path*', headers }];
  },
});
export default nextConfig;
