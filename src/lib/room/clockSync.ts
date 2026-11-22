import type { SignalingTransport } from '@/lib/signaling/types';

/** Server-aligned "now" in epoch ms: Date.now() plus the smoothed offset measured by the transport. */
export function serverNow(transport: Pick<SignalingTransport, 'getClockOffsetMs'>): number {
  return Date.now() + transport.getClockOffsetMs();
}
