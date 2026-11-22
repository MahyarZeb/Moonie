export type VerifyState = 'no-file' | 'checking' | 'match' | 'mismatch';

export interface FileIdentity {
  name: string;
  size: number;
  hash?: string;
}

const normalize = (name: string) => name.trim().toLowerCase();

/**
 * Whether the participant's file is the host's file. With a hash on both sides the hash and size must
 * agree. Otherwise the size and the case-insensitive name must agree. `lastModified` is not compared.
 */
export function verifyLocalFile(local: FileIdentity, host: FileIdentity): 'match' | 'mismatch' {
  if (local.size !== host.size) return 'mismatch';
  if (local.hash && host.hash) return local.hash === host.hash ? 'match' : 'mismatch';
  return normalize(local.name) === normalize(host.name) ? 'match' : 'mismatch';
}
