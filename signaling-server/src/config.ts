import { DEFAULTS } from '../../shared/constants';
import { parseLevel, type Logger, type LogLevel } from './log';

export interface Config {
  port: number;
  allowedOrigins: string[];
  allowNoOrigin: boolean;
  maxRooms: number;
  maxParticipants: number;
  maxConnectionsPerIp: number;
  trustProxyHops: number;
  logLevel: LogLevel;
  reconnectGraceMs: number;
  hostGraceMs: number;
  emptyRoomTtlMs: number;
  maxRoomAgeMs: number;
  sweepIntervalMs: number;
  turnSkipMs: number;
  idleMs: number;
  unjoinedMaxMs: number;
  pingIntervalMs: number;
  pongTimeoutMs: number;
  hostedByPlatform: boolean;
}

type Env = Record<string, string | undefined>;

function int(env: Env, key: string, fallback: number, min: number, warnings: string[]): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    warnings.push(`${key} is invalid, using ${fallback}`);
    return fallback;
  }
  return n;
}

/** Parses environment variables. Invalid numbers fall back to defaults with a warning. */
export function loadConfig(env: Env, log?: Logger): Config {
  const warnings: string[] = [];
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const config: Config = {
    port: int(env, 'PORT', DEFAULTS.port, 0, warnings),
    allowedOrigins,
    allowNoOrigin: env.ALLOW_NO_ORIGIN === 'true',
    maxRooms: int(env, 'MAX_ROOMS', DEFAULTS.maxRooms, 1, warnings),
    maxParticipants: int(env, 'ROOM_MAX_PARTICIPANTS', DEFAULTS.maxParticipants, 1, warnings),
    maxConnectionsPerIp: int(env, 'MAX_CONNECTIONS_PER_IP', DEFAULTS.maxConnectionsPerIp, 1, warnings),
    trustProxyHops: int(env, 'TRUST_PROXY_HOPS', 1, 0, warnings),
    logLevel: parseLevel(env.LOG_LEVEL),
    reconnectGraceMs: int(env, 'RECONNECT_GRACE_MS', DEFAULTS.reconnectGraceMs, 0, warnings),
    hostGraceMs: int(env, 'HOST_GRACE_MS', DEFAULTS.hostGraceMs, 0, warnings),
    emptyRoomTtlMs: int(env, 'EMPTY_ROOM_TTL_MS', DEFAULTS.emptyRoomTtlMs, 0, warnings),
    maxRoomAgeMs: int(env, 'MAX_ROOM_AGE_MS', DEFAULTS.maxRoomAgeMs, 1, warnings),
    sweepIntervalMs: int(env, 'SWEEP_INTERVAL_MS', DEFAULTS.sweepIntervalMs, 10, warnings),
    turnSkipMs: int(env, 'TURN_SKIP_MS', DEFAULTS.turnSkipMs, 0, warnings),
    idleMs: int(env, 'IDLE_MS', DEFAULTS.idleMs, 100, warnings),
    unjoinedMaxMs: int(env, 'UNJOINED_MAX_MS', DEFAULTS.unjoinedMaxMs, 100, warnings),
    pingIntervalMs: DEFAULTS.pingIntervalMs,
    pongTimeoutMs: DEFAULTS.pongTimeoutMs,
    hostedByPlatform: Boolean(env.PORT),
  };
  for (const w of warnings) log?.warn(w);
  return config;
}
