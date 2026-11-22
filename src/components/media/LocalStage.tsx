'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, CheckCircle2, Clapperboard, FileVideo, MonitorOff, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { formatBytes } from '@/lib/localfile/support';
import { verifyLocalFile, type VerifyState } from '@/lib/localfile/verify';
import { useRoom, useRoomController } from '@/lib/room/RoomProvider';
import { selectIsHost } from '@/lib/room/selectors';
import { formatDuration } from '@/lib/utils/format';
import { FileDropzone } from './FileDropzone';
import { LocalPlayer, type LocalMedia } from './LocalPlayer';
import { ViewerScreen } from './ScreenView';

/**
 * The main player area for a local video. Mount with a key built from the file identity so the
 * "watch anyway" choice resets for a new file, but not on same-file and stream conversions.
 */
export function LocalStage({ media }: { media: LocalMedia }) {
  const controller = useRoomController();
  const isHost = useRoom(selectIsHost);
  const selfId = useRoom((s) => s.selfId);
  const store = controller.localFile;
  const lf = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [overrideFile, setOverrideFile] = useState<File | null>(null);

  const verdict: VerifyState =
    lf.status === 'checking' ? 'checking' : lf.meta ? verifyLocalFile(lf.meta, media.file) : 'no-file';
  const overridden = verdict === 'mismatch' && overrideFile !== null && overrideFile === lf.file;
  const verified = verdict === 'match' || overridden;

  useReadySignal(media, verified);

  const { sharerId, sessionId } = media;
  if (media.delivery === 'stream' && sharerId && sessionId && sharerId !== selfId) {
    return <StreamView key={sessionId} media={media} sharerId={sharerId} sessionId={sessionId} />;
  }

  if (verified && lf.url) {
    return (
      <section aria-label="Local video" className="space-y-3">
        <LocalPlayer media={media} url={lf.url} isHost={isHost} />
        <LocalInfoBar media={media} isHost={isHost} overridden={overridden} onChangeFile={() => store.clear()} />
      </section>
    );
  }

  return (
    <PickSameFile
      media={media}
      isHost={isHost}
      verdict={verdict}
      error={lf.error}
      onFile={(file) => void store.pick(file)}
      onOverride={() => setOverrideFile(lf.file)}
    />
  );
}

/** Tells the server whether this tab holds the right file, once per media revision. */
function useReadySignal(media: LocalMedia, ready: boolean): void {
  const controller = useRoomController();
  const sent = useRef<{ rev: number; ready: boolean } | null>(null);
  const { rev, delivery } = media;
  useEffect(() => {
    if (delivery !== 'same-file') return;
    const prev = sent.current;
    if (!ready && !prev?.ready) return;
    if (prev && prev.rev === rev && prev.ready === ready) return;
    sent.current = { rev, ready };
    controller.transport.send({ type: 'local:ready', rev, ready });
  }, [controller, rev, delivery, ready]);
}

function StreamView({ media, sharerId, sessionId }: { media: LocalMedia; sharerId: string; sessionId: string }) {
  const hostName = useRoom((s) => s.snapshot?.participants.find((p) => p.id === sharerId)?.name ?? 'The host');
  return (
    <section aria-label="Streamed video" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <Badge tone="blue" role="status">
          <Clapperboard size={12} aria-hidden /> Streaming 🎞️
        </Badge>
        <span className="min-w-0 truncate text-sm font-semibold text-ink-soft">
          {hostName} is streaming {media.file.name} from their device
        </span>
      </div>
      <ViewerScreen sharerId={sharerId} sessionId={sessionId} hasAudio={media.hasAudio ?? false} />
      <p className="px-1 text-xs text-ink-soft">The host controls playback. You can still change volume and go fullscreen.</p>
    </section>
  );
}

function LocalInfoBar({
  media,
  isHost,
  overridden,
  onChangeFile,
}: {
  media: LocalMedia;
  isHost: boolean;
  overridden: boolean;
  onChangeFile: () => void;
}) {
  const controller = useRoomController();
  const participants = useRoom((s) => s.snapshot?.participants);
  const connected = participants?.filter((p) => p.connected) ?? [];
  const ready = connected.filter((p) => p.hasFile).length;
  const streaming = media.delivery === 'stream';
  const { file } = media;

  return (
    <div className="space-y-2 px-1">
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-soft">
        <FileVideo size={16} aria-hidden />
        <span className="min-w-0 truncate text-ink">{file.name}</span>
        <span>
          {formatBytes(file.size)}
          {file.durationSec ? ` · ${formatDuration(file.durationSec)}` : ''}
        </span>
        {streaming && (
          <Badge tone="blue" role="status">
            <Clapperboard size={12} aria-hidden /> Streaming 🎞️
          </Badge>
        )}
        {isHost && !streaming && (
          <Badge tone="lavender" aria-live="polite">
            <CheckCircle2 size={12} aria-hidden /> {ready} of {connected.length} ready
          </Badge>
        )}
      </div>
      {isHost && streaming && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-soft">Everyone else is watching a live stream of your player.</span>
          <Button size="sm" variant="danger" icon={<MonitorOff size={14} aria-hidden />} onClick={() => controller.share.stop()}>
            Stop streaming
          </Button>
        </div>
      )}
      {!isHost && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
          <ShieldCheck size={14} aria-hidden />
          <span>
            {overridden
              ? 'This is a different file, so the picture may drift out of sync.'
              : 'Your copy stays on your device. The host controls playback.'}
          </span>
          <button type="button" className="font-bold text-ink underline" onClick={onChangeFile}>
            Use a different file
          </button>
        </div>
      )}
    </div>
  );
}

function PickSameFile({
  media,
  isHost,
  verdict,
  error,
  onFile,
  onOverride,
}: {
  media: LocalMedia;
  isHost: boolean;
  verdict: VerifyState;
  error: string | null;
  onFile: (file: File) => void;
  onOverride: () => void;
}) {
  const hostName = useRoom((s) => s.snapshot?.participants.find((p) => p.id === s.snapshot?.hostId)?.name ?? 'The host');
  const { file } = media;

  return (
    <section aria-label="Pick the same file" className="card-soft stage-backdrop space-y-4 p-6">
      <div className="space-y-1 text-center">
        <p className="text-3xl" aria-hidden>
          🎞️
        </p>
        <h2 className="text-xl">
          {isHost ? 'Pick your file again' : `${hostName} is watching`}
        </h2>
        <p className="break-words font-bold">
          {file.name} <span className="font-semibold text-ink-soft">({formatBytes(file.size)})</span>
        </p>
        <p className="mx-auto max-w-md text-sm text-ink-soft">
          {isHost
            ? 'This browser lost track of the file. Pick it again to control playback.'
            : 'Pick the same file from your device to watch together. Your file never leaves your device.'}
        </p>
      </div>

      {verdict === 'checking' ? (
        <p className="flex items-center justify-center gap-2 font-semibold" role="status">
          <Spinner size={18} label="Checking your file" /> Checking your file…
        </p>
      ) : (
        <FileDropzone onFile={onFile} title={verdict === 'mismatch' ? 'Pick a different file' : undefined} />
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-2xl bg-pink/30 p-3 text-sm font-semibold" role="alert">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {verdict === 'mismatch' && (
        <div className="space-y-2 rounded-2xl bg-pink/30 p-3 text-center" role="alert">
          <p className="font-bold">That doesn&apos;t look like the same file</p>
          <p className="text-sm text-ink-soft">The name, size or contents are different from the host&apos;s file.</p>
          <Button size="sm" variant="secondary" onClick={onOverride}>
            Watch anyway (may be out of sync)
          </Button>
        </div>
      )}
    </section>
  );
}
