import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { LIMITS } from '../../shared/constants';
import { parseClientMessage } from '../../shared/validate';
import type { Config } from './config';
import { Conn, idleReason, type HandlerContext } from './connection';
import { dispatch } from './handlers';
import type { Logger } from './log';
import { createOEmbedResolver, type MetadataResolver } from './metadata';
import { isOriginAllowed } from './origin';
import { clientIp } from './rateLimit';
import { RoomRegistry } from './registry';
import type { Clock } from './room';

export interface RunningServer {
  server: Server;
  registry: RoomRegistry;
  /** Resolves with the bound port. */
  listen(): Promise<number>;
  close(): Promise<void>;
  connectionCount(): number;
}

const systemClock: Clock = { now: () => Date.now() };

function reject(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/** Builds the HTTP + WebSocket server. Nothing runs until `listen()`. */
export function createSignalingServer(
  config: Config,
  log: Logger,
  clock: Clock = systemClock,
  metadata: MetadataResolver = createOEmbedResolver(),
): RunningServer {
  const registry = new RoomRegistry(clock, config, log, undefined, metadata);
  const ctx: HandlerContext = { registry, config, clock, log };
  const conns = new Set<Conn>();
  const ipCounts = new Map<string, number>();
  const startedAt = clock.now();
  let nextConnId = 1;

  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.maxFrameBytes });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && path === '/health') {
      const origin = req.headers.origin;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (origin && isOriginAllowed(origin, config.allowedOrigins, false)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers.Vary = 'Origin';
      }
      res.writeHead(200, headers);
      res.end(
        JSON.stringify({
          ok: true,
          rooms: registry.size,
          connections: conns.size,
          uptime: Math.round((clock.now() - startedAt) / 1000),
        }),
      );
      return;
    }
    if (req.method === 'GET' && path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Moonie signaling server');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const origin = req.headers.origin;
    if (!isOriginAllowed(origin, config.allowedOrigins, config.allowNoOrigin)) {
      log.warn('origin rejected', { origin: String(origin ?? '').slice(0, 200) });
      return reject(socket, 403, 'Forbidden');
    }
    const ip = clientIp(req, config.trustProxyHops);
    if ((ipCounts.get(ip) ?? 0) >= config.maxConnectionsPerIp) {
      log.warn('connection limit reached', { ip });
      return reject(socket, 429, 'Too Many Requests');
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, ip));
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, ip: string) => {
    const conn = new Conn(nextConnId++, ip, ws, clock.now());
    conns.add(conn);
    ipCounts.set(ip, (ipCounts.get(ip) ?? 0) + 1);
    log.debug('connection opened', { id: conn.id, connections: conns.size });

    ws.on('pong', () => {
      conn.lastPongAt = clock.now();
    });

    ws.on('message', (data, isBinary) => {
      const now = clock.now();
      conn.lastMessageAt = now;
      if (isBinary) return conn.error('bad_request', 'Text frames only');
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString('utf8'));
      } catch {
        return conn.error('bad_request', 'Invalid JSON');
      }
      const type = typeof raw === 'object' && raw !== null && typeof (raw as { type?: unknown }).type === 'string'
        ? (raw as { type: string }).type
        : '';
      if (!conn.limiter.allow(type, now)) {
        conn.error('rate_limited', 'Slow down a little');
        if (conn.abuse.hit(now)) {
          log.warn('closing socket for rate-limit abuse', { id: conn.id });
          ws.close(1008, 'rate limited');
        }
        return;
      }
      const parsed = parseClientMessage(raw);
      if (!parsed.ok) {
        if (parsed.warn) log.warn('dropped signal', { reason: parsed.warn });
        else log.debug('invalid message', { type, message: parsed.message });
        if (!parsed.silent) conn.error(parsed.code, parsed.message, parsed.ref);
        return;
      }
      const msg = parsed.msg;
      conn.chain = conn.chain
        .then(() => dispatch(ctx, conn, msg))
        .catch((err: unknown) => {
          log.error('handler failed', { type: msg.type, error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
          conn.error('bad_request', 'Something went wrong', msg.ref);
        });
    });

    ws.on('close', () => {
      conn.closed = true;
      conns.delete(conn);
      const left = (ipCounts.get(ip) ?? 1) - 1;
      if (left <= 0) ipCounts.delete(ip);
      else ipCounts.set(ip, left);
      if (conn.room && conn.pid) conn.room.disconnect(conn.pid, ws);
      log.debug('connection closed', { id: conn.id, connections: conns.size });
    });

    ws.on('error', (err) => log.debug('socket error', { id: conn.id, error: String(err) }));
  });

  let sweepTimer: NodeJS.Timeout | undefined;
  let pingTimer: NodeJS.Timeout | undefined;

  function sweepConnections(): void {
    const now = clock.now();
    for (const conn of conns) {
      const reason = idleReason(conn, now, config);
      if (reason) {
        log.debug('closing idle socket', { id: conn.id, reason });
        conn.socket.close(1008, reason);
      }
    }
  }

  function pingConnections(): void {
    const now = clock.now();
    for (const conn of conns) {
      if (now - conn.lastPongAt > config.pongTimeoutMs) {
        (conn.socket as WebSocket).terminate();
        continue;
      }
      try {
        (conn.socket as WebSocket).ping();
      } catch {
        /* closing */
      }
    }
  }

  return {
    server,
    registry,
    connectionCount: () => conns.size,
    listen: () =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, '0.0.0.0', () => {
          server.off('error', reject);
          sweepTimer = setInterval(() => {
            try {
              registry.sweep();
              sweepConnections();
            } catch (err) {
              log.error('sweep failed', { error: String(err) });
            }
          }, config.sweepIntervalMs);
          pingTimer = setInterval(pingConnections, config.pingIntervalMs);
          sweepTimer.unref();
          pingTimer.unref();
          const addr = server.address();
          resolve(typeof addr === 'object' && addr ? addr.port : config.port);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        if (sweepTimer) clearInterval(sweepTimer);
        if (pingTimer) clearInterval(pingTimer);
        for (const conn of conns) conn.socket.close(1001, 'server shutting down');
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
