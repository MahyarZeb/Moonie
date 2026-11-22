import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './constants';

/** Generates a room code. `rng` returns a float in [0, 1). */
export function generateCode(rng: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ROOM_CODE_ALPHABET[Math.floor(rng() * ROOM_CODE_ALPHABET.length)];
  }
  return out;
}

/** Uppercases and strips spaces and hyphens. Returns null when the result is not a valid code. */
export function normalizeCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]+/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** Accepts a raw code or a pasted invite URL (`.../room/CODE`, with optional query or hash). */
export function parseRoomInput(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const direct = normalizeCode(text);
  if (direct) return direct;
  const match = /\/room\/([^/?#\s]+)/i.exec(text);
  if (match) {
    let seg = match[1];
    try {
      seg = decodeURIComponent(seg);
    } catch {
      return null;
    }
    return normalizeCode(seg);
  }
  return null;
}
