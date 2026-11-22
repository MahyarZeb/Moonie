export type ScreenShareSupport = 'ok' | 'insecure' | 'unsupported';

/** Whether this browser can capture the screen. `getDisplayMedia` needs HTTPS or localhost. */
export function getScreenShareSupport(): ScreenShareSupport {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  if (typeof RTCPeerConnection === 'undefined') return 'unsupported';
  if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
    return window.isSecureContext === false ? 'insecure' : 'unsupported';
  }
  return window.isSecureContext === false ? 'insecure' : 'ok';
}

/** Whether this browser can receive a shared screen. */
export function canReceiveStream(): boolean {
  return typeof RTCPeerConnection !== 'undefined';
}
