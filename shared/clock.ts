export interface ClockSample {
  rtt: number;
  offset: number;
}

const WINDOW = 12;
const BEST = 5;

/** `offset = serverTime - (t0 + rtt / 2)`, where `t0` comes from `Date.now()` and `rtt` from a monotonic clock. */
export function sampleFromPong(t0: number, serverTime: number, rtt: number): ClockSample {
  return { rtt, offset: serverTime - (t0 + rtt / 2) };
}

/** Median offset of the lowest-RTT samples among the most recent ones. */
export function estimateOffset(samples: readonly ClockSample[]): number {
  if (samples.length === 0) return 0;
  const recent = samples.slice(-WINDOW);
  const best = [...recent].sort((a, b) => a.rtt - b.rtt).slice(0, BEST);
  const offsets = best.map((s) => s.offset).sort((a, b) => a - b);
  const mid = Math.floor(offsets.length / 2);
  return offsets.length % 2 ? offsets[mid] : (offsets[mid - 1] + offsets[mid]) / 2;
}
