import { loadConfig } from './config';
import { createLogger } from './log';
import { createSignalingServer } from './server';

const bootLog = createLogger('info');
const config = loadConfig(process.env, bootLog);
const log = createLogger(config.logLevel);

if (config.allowedOrigins.length === 0) {
  log.warn('ALLOWED_ORIGINS is not set: every browser origin will be rejected');
}
if (config.allowedOrigins.includes('*')) {
  log.warn('ALLOWED_ORIGINS contains "*": any website can open a socket to this server');
}
if (config.hostedByPlatform && config.trustProxyHops === 0) {
  log.warn('PORT is set but TRUST_PROXY_HOPS is 0: all users behind the proxy will share one IP');
}

const app = createSignalingServer(config, log);

process.on('uncaughtException', (err) => log.error('uncaughtException', { error: err.stack ?? String(err) }));
process.on('unhandledRejection', (reason) => log.error('unhandledRejection', { error: String(reason) }));

let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  log.info('shutting down', { signal });
  const force = setTimeout(() => process.exit(0), 5000);
  force.unref();
  app.registry.closeAll();
  void app.close().then(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

app
  .listen()
  .then((port) => log.info('signaling server listening', { port }))
  .catch((err: unknown) => {
    log.error('failed to start', { error: String(err) });
    process.exit(1);
  });
