/**
 * Origin allow-list. Fails closed: an empty list allows nothing.
 * Entries are exact origins, `https://*.example.com` (one or more subdomain labels), or `*`.
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowed: readonly string[],
  allowNoOrigin: boolean,
): boolean {
  if (!origin) return allowNoOrigin;
  if (allowed.length === 0) return false;
  let normalized: string;
  try {
    normalized = new URL(origin).origin;
  } catch {
    return false;
  }
  for (const entry of allowed) {
    if (entry === '*') return true;
    if (entry === normalized || entry === origin) return true;
    const wild = /^(https?):\/\/\*\.(.+)$/.exec(entry);
    if (wild) {
      const url = new URL(normalized);
      const scheme = `${wild[1]}:`;
      const suffix = `.${wild[2]}`;
      if (url.protocol === scheme && url.host.endsWith(suffix) && url.host.length > suffix.length) return true;
    }
  }
  return false;
}
