const CHUNK = 1024 * 1024;

/**
 * Quick fingerprint: SHA-256 over the first MiB, the last MiB and the size (8 bytes, big endian).
 * Returns lowercase hex, or undefined when `crypto.subtle` is unavailable (insecure context).
 */
export async function quickHash(file: Blob): Promise<string | undefined> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (!subtle) return undefined;
  const head = await file.slice(0, CHUNK).arrayBuffer();
  const tail = file.size > CHUNK ? await file.slice(Math.max(CHUNK, file.size - CHUNK)).arrayBuffer() : new ArrayBuffer(0);
  const sizeBytes = new ArrayBuffer(8);
  new DataView(sizeBytes).setBigUint64(0, BigInt(file.size));
  const data = new Uint8Array(head.byteLength + tail.byteLength + 8);
  data.set(new Uint8Array(head), 0);
  data.set(new Uint8Array(tail), head.byteLength);
  data.set(new Uint8Array(sizeBytes), head.byteLength + tail.byteLength);
  const digest = await subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
