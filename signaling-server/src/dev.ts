// Local development entry: sets safe defaults for a machine running the Next dev server, then starts the server.
process.env.ALLOWED_ORIGINS ??= 'http://localhost:3000,http://127.0.0.1:3000';
process.env.TRUST_PROXY_HOPS ??= '0';
process.env.LOG_LEVEL ??= 'debug';

void import('./index');
