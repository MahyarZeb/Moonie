'use client';

import { useState, useSyncExternalStore } from 'react';
import { AlertTriangle, CheckCircle2, Clapperboard, FileVideo, MonitorOff, Play, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { captureFileStream, supportsCaptureStream } from '@/lib/localfile/captureStream';
import { formatBytes } from '@/lib/localfile/support';
import { TransportError } from '@/lib/signaling/types';
import { useRoom, useRoomController } from '@/lib/room/RoomProvider';
import { formatDuration } from '@/lib/utils/format';
import { FileDropzone } from './FileDropzone';

/** Host-only: pick a local video, start watching it together, and optionally stream it from this device. */
export function LocalFilePanel() {
  const controller = useRoomController();
  const store = controller.localFile;
  const lf = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const share = controller.share;
  const shareState = useSyncExternalStore(share.subscribe, share.getState, share.getState);
  const media = useRoom((s) => s.snapshot?.media ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canCapture = useSyncExternalStore(
    () => () => undefined,
    supportsCaptureStream,
    () => true,
  );

  const current = media?.kind === 'local' ? media : null;
  const isCurrent =
    !!current &&
    !!lf.meta &&
    lf.meta.name === current.file.name &&
    lf.meta.size === current.file.size &&
    lf.meta.lastModified === current.file.lastModified;
  const streaming = current?.delivery === 'stream' && shareState.status === 'sharing';

  const watch = async () => {
    if (!lf.meta) return;
    setBusy(true);
    setError(null);
    try {
      await controller.transport.request({ type: 'media:set', media: { kind: 'local', file: lf.meta, delivery: 'same-file' } });
    } catch (err) {
      setError(err instanceof TransportError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const stream = async () => {
    if (!current) return;
    const video = store.getElement();
    if (!video) {
      setError('The player is not ready yet. Give it a second and try again.');
      return;
    }
    setBusy(true);
    setError(null);
    const cap = await captureFileStream(video);
    if (!cap.ok) {
      setError(cap.message);
      setBusy(false);
      return;
    }
    await share.startFile(cap.stream, cap.hasAudio, current.file);
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2 text-sm text-ink-soft">
        <p>
          <strong className="text-ink">Same file (works everywhere):</strong> you pick a video and everyone else picks the same file from
          their own device. Moonie keeps play, pause and seeking in sync. Nothing is uploaded.
        </p>
        <p>
          <strong className="text-ink">Stream from my device (optional):</strong> your browser sends the video to everyone live, so they
          don&apos;t need the file. Works in Chrome, Edge and Firefox. Safari can&apos;t do this yet. Quality depends on your upload speed and
          is best with up to about 4 people.
        </p>
      </div>

      {lf.status === 'checking' ? (
        <p className="flex items-center gap-2 font-semibold" role="status">
          <Spinner size={18} label="Checking your file" /> Checking your file…
        </p>
      ) : lf.meta && lf.url ? (
        <div className="space-y-3 rounded-3xl bg-surface-2 p-3">
          <div className="flex items-start gap-2">
            <FileVideo size={18} className="mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{lf.meta.name}</p>
              <p className="text-xs font-semibold text-ink-soft">
                {formatBytes(lf.meta.size)}
                {lf.meta.durationSec ? ` · ${formatDuration(lf.meta.durationSec)}` : ''}
              </p>
            </div>
            <Button size="sm" variant="ghost" icon={<X size={14} aria-hidden />} onClick={() => store.clear()}>
              Remove
            </Button>
          </div>
          {!isCurrent && (
            <video
              src={lf.url}
              controls
              muted
              preload="metadata"
              aria-label="Preview of your video"
              className="max-h-48 w-full rounded-2xl bg-black object-contain"
            />
          )}
          {isCurrent ? (
            <p className="flex items-center gap-2 text-sm font-bold" role="status">
              <CheckCircle2 size={16} aria-hidden /> You are watching this together
            </p>
          ) : (
            <Button icon={<Play size={16} aria-hidden />} loading={busy} onClick={() => void watch()}>
              Watch together
            </Button>
          )}
        </div>
      ) : (
        <FileDropzone onFile={(file) => void store.pick(file)} />
      )}

      {isCurrent && (
        <div className="space-y-2 rounded-3xl bg-surface-2 p-3">
          {streaming ? (
            <>
              <p className="flex items-center gap-2 text-sm font-bold" role="status">
                <Clapperboard size={16} aria-hidden /> Streaming 🎞️ Everyone sees your player live.
              </p>
              <Button size="sm" variant="danger" icon={<MonitorOff size={14} aria-hidden />} onClick={() => share.stop()}>
                Stop streaming
              </Button>
            </>
          ) : canCapture ? (
            <>
              <p className="text-sm text-ink-soft">Others don&apos;t have the file? Stream it from your device instead.</p>
              <Button
                size="sm"
                variant="secondary"
                icon={<Clapperboard size={14} aria-hidden />}
                loading={busy || shareState.status === 'starting'}
                onClick={() => void stream()}
              >
                Stream from my device
              </Button>
            </>
          ) : (
            <p className="text-sm text-ink-soft">
              Your browser can&apos;t stream a file directly. Using the same-file mode instead: ask everyone to pick the same file.
            </p>
          )}
        </div>
      )}

      {(lf.error || error || shareState.error) && (
        <p className="flex items-start gap-2 rounded-2xl bg-pink/30 p-3 text-sm font-semibold" role="alert">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {lf.error ?? error ?? shareState.error?.message}
        </p>
      )}
    </div>
  );
}
