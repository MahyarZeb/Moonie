export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function parseLevel(v: string | undefined): LogLevel {
  return v === 'debug' || v === 'info' || v === 'warn' || v === 'error' ? v : 'info';
}

/** Structured logger. Never pass message bodies, passwords or chat text. */
export function createLogger(level: LogLevel = 'info', write: (line: string) => void = (l) => console.log(l)): Logger {
  const emit = (lvl: LogLevel) => (msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    write(JSON.stringify({ t: new Date().toISOString(), level: lvl, msg, ...fields }));
  };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
