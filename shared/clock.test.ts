import { describe, expect, it } from 'vitest';
import { estimateOffset, sampleFromPong } from './clock';
import { expectedPosition } from './playback';

describe('clock', () => {
  it('computes offset from a pong', () => {
    // server is 1000 ms ahead, rtt 100
    expect(sampleFromPong(5000, 6050, 100)).toEqual({ rtt: 100, offset: 1000 });
  });
  it('is 0 without samples', () => expect(estimateOffset([])).toBe(0));
  it('takes the median of the lowest-RTT samples and ignores slow outliers', () => {
    const samples = [
      { rtt: 500, offset: 9000 },
      { rtt: 20, offset: 100 },
      { rtt: 30, offset: 110 },
      { rtt: 25, offset: 90 },
      { rtt: 40, offset: 120 },
      { rtt: 35, offset: 105 },
      { rtt: 900, offset: -5000 },
    ];
    expect(estimateOffset(samples)).toBe(105);
  });
  it('only looks at the last 12 samples', () => {
    const old = Array.from({ length: 10 }, () => ({ rtt: 1, offset: 5000 }));
    const recent = Array.from({ length: 12 }, () => ({ rtt: 10, offset: 7 }));
    expect(estimateOffset([...old, ...recent])).toBe(7);
  });
});

describe('expectedPosition', () => {
  const base = { rev: 1, status: 'playing' as const, positionSec: 10, updatedAt: 1000 };
  it('extrapolates while playing', () => expect(expectedPosition(base, 3500)).toBe(12.5));
  it('does not move while paused', () => expect(expectedPosition({ ...base, status: 'paused' }, 9000)).toBe(10));
  it('clamps to duration and to zero', () => {
    expect(expectedPosition(base, 100000, 20)).toBe(20);
    expect(expectedPosition(base, 0)).toBe(10);
  });
});
