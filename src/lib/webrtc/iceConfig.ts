const DEFAULT_STUN = 'stun:stun.l.google.com:19302';

export interface IceEnv {
  stunUrls?: string;
  turnUrl?: string;
  turnUsername?: string;
  turnCredential?: string;
}

const splitList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Builds the ICE server list from env-style values. Pure so it can be tested. */
export function buildIceServers(env: IceEnv): RTCIceServer[] {
  const stun = splitList(env.stunUrls);
  const servers: RTCIceServer[] = [{ urls: stun.length > 0 ? stun : [DEFAULT_STUN] }];
  const turn = splitList(env.turnUrl);
  if (turn.length > 0) {
    servers.push({ urls: turn, username: env.turnUsername ?? '', credential: env.turnCredential ?? '' });
  }
  return servers;
}

/**
 * The RTCPeerConnection configuration for every link. `NEXT_PUBLIC_*` values are inlined at build time
 * and visible to every visitor, so static TURN credentials are public (see README).
 */
export function getRtcConfiguration(): RTCConfiguration {
  return {
    iceServers: buildIceServers({
      stunUrls: process.env.NEXT_PUBLIC_STUN_URLS,
      turnUrl: process.env.NEXT_PUBLIC_TURN_URL,
      turnUsername: process.env.NEXT_PUBLIC_TURN_USERNAME,
      turnCredential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    }),
    iceCandidatePoolSize: 0,
    bundlePolicy: 'max-bundle',
  };
}
