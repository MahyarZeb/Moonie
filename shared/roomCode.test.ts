import { describe, expect, it } from 'vitest';
import { ROOM_CODE_ALPHABET } from './constants';
import { generateCode, normalizeCode, parseRoomInput } from './roomCode';

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('generateCode', () => {
  it('is 6 chars from the alphabet and deterministic for a seed', () => {
    const a = generateCode(seeded(42));
    const b = generateCode(seeded(42));
    expect(a).toBe(b);
    expect(a).toHaveLength(6);
    for (const ch of a) expect(ROOM_CODE_ALPHABET).toContain(ch);
  });
  it('never returns an out-of-range index at the edges', () => {
    expect(generateCode(() => 0)).toBe('AAAAAA');
    expect(generateCode(() => 0.999999)).toBe('999999');
  });
});

describe('normalizeCode', () => {
  it('handles case, spaces and hyphens', () => {
    expect(normalizeCode('abc-234')).toBe('ABC234');
    expect(normalizeCode(' ab c2 34 ')).toBe('ABC234');
  });
  it('rejects wrong length and lookalike characters', () => {
    expect(normalizeCode('ABC23')).toBeNull();
    expect(normalizeCode('ABC2345')).toBeNull();
    expect(normalizeCode('ABCDE0')).toBeNull();
    expect(normalizeCode('ABCDEI')).toBeNull();
  });
});

describe('parseRoomInput', () => {
  it('accepts a raw code', () => expect(parseRoomInput('abcd23')).toBe('ABCD23'));
  it('accepts invite URLs with query or hash', () => {
    expect(parseRoomInput('https://moonie.example.com/room/ABCD23')).toBe('ABCD23');
    expect(parseRoomInput('https://moonie.example.com/room/abcd23?x=1#y')).toBe('ABCD23');
    expect(parseRoomInput('moonie.example.com/room/ABCD23/')).toBe('ABCD23');
  });
  it('rejects garbage', () => {
    expect(parseRoomInput('')).toBeNull();
    expect(parseRoomInput('hello world')).toBeNull();
    expect(parseRoomInput('https://x.com/room/')).toBeNull();
    expect(parseRoomInput('https://x.com/room/%E0%A4%A')).toBeNull();
  });
});
