// Local development entry: sets safe defaults for a machine running the Next dev server, then starts the server.
// A global PORT (set for Next or another tool) must not move the dev signaling server. Use SIGNALING_PORT, else the default 8787.
if (process.env.SIGNALING_PORT) process.env.PORT = process.env.SIGNALING_PORT;
else delete process.env.PORT;
process.env.ALLOWED_ORIGINS ??= 'http://localhost:3000,http://127.0.0.1:3000';
process.env.TRUST_PROXY_HOPS ??= '0';
process.env.LOG_LEVEL ??= 'debug';

void import('./index');
