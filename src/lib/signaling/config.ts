/** Returns the validated signaling URL, or null when it is missing or not a ws:// or wss:// URL. */
export function parseSignalingUrl(value: string | undefined): string | null {
  const url = (value ?? '').trim();
  return /^wss?:\/\/[^\s/]+/i.test(url) ? url : null;
}

/** NEXT_PUBLIC_* variables must be read with a literal key so Next can inline them at build time. */
export function getSignalingUrl(): string | null {
  return parseSignalingUrl(process.env.NEXT_PUBLIC_SIGNALING_URL);
}

/** True when an https page is configured with an insecure ws:// signaling URL, which browsers block. */
export function isMixedContent(url: string | null, pageProtocol: string): boolean {
  return !!url && pageProtocol === 'https:' && url.toLowerCase().startsWith('ws://');
}
