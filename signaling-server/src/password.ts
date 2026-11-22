import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export interface PasswordHash {
  salt: Buffer;
  hash: Buffer;
}

const KEY_LEN = 64;
const DEFAULT_COST: ScryptOptions = { N: 16384, r: 8, p: 1 };

function derive(password: string, salt: Buffer, cost: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, cost, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Hashes with scrypt and a random 16-byte salt. The result lives in room memory only. */
export async function hashPassword(password: string, cost: ScryptOptions = DEFAULT_COST): Promise<PasswordHash> {
  const salt = randomBytes(16);
  return { salt, hash: await derive(password, salt, cost) };
}

export async function verifyPassword(
  password: string,
  stored: PasswordHash,
  cost: ScryptOptions = DEFAULT_COST,
): Promise<boolean> {
  const candidate = await derive(password, stored.salt, cost);
  return candidate.length === stored.hash.length && timingSafeEqual(candidate, stored.hash);
}
