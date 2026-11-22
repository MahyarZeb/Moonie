import { AVATAR_IDS, IDENTITY_STORAGE_KEY, SESSION_STORAGE_KEY } from '@shared/constants';
import type { AvatarId } from '@shared/protocol';
import { isAvatarId, sanitizeName } from '@shared/validate';
import { LIMITS } from '@shared/constants';

/**
 * Thin identity module. Today it is a display name and avatar kept in localStorage.
 * A real auth provider can replace `loadIdentity`/`saveIdentity` later without touching callers.
 */
export interface Identity {
  displayName: string;
  avatar: AvatarId;
}

export interface StoredSession {
  code: string;
  resumeToken: string;
}

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function randomAvatar(rng: () => number = Math.random): AvatarId {
  return AVATAR_IDS[Math.floor(rng() * AVATAR_IDS.length)];
}

export function loadIdentity(): Identity | null {
  const raw = storage('local')?.getItem(IDENTITY_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Identity>;
    const displayName = sanitizeName(parsed.displayName, LIMITS.displayNameMax);
    if (displayName && isAvatarId(parsed.avatar)) return { displayName, avatar: parsed.avatar };
  } catch {
    /* ignore corrupt data */
  }
  return null;
}

export function saveIdentity(identity: Identity): void {
  try {
    storage('local')?.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  } catch {
    /* storage may be full or blocked */
  }
}

export function readSession(): StoredSession | null {
  const raw = storage('session')?.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.code === 'string' && typeof parsed.resumeToken === 'string' && parsed.resumeToken) {
      return { code: parsed.code, resumeToken: parsed.resumeToken };
    }
  } catch {
    /* ignore corrupt data */
  }
  return null;
}

export function writeSession(session: StoredSession): void {
  try {
    storage('session')?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function clearSession(): void {
  try {
    storage('session')?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
