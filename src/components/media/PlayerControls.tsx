'use client';

import { Lock, Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { formatDuration } from '@/lib/utils/format';

interface Props {
  paused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  /** Only the host can play, pause and seek. */
  canControl: boolean;
  onTogglePlay: () => void;
  onSeek: (sec: number) => void;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  onFullscreen: () => void;
}

/** Custom controls for the local video player. Followers see a locked play button and a read-only timeline. */
export function PlayerControls(p: Props) {
  const max = p.duration > 0 ? p.duration : 0;
  return (
    <div className="flex flex-wrap items-center gap-2 bg-surface/90 px-3 py-2 text-ink">
      {p.canControl ? (
        <IconButton label={p.paused ? 'Play' : 'Pause'} onClick={p.onTogglePlay}>
          {p.paused ? <Play size={18} /> : <Pause size={18} />}
        </IconButton>
      ) : (
        <IconButton label="Host controls playback" disabled>
          <Lock size={16} />
        </IconButton>
      )}
      <span className="w-24 shrink-0 text-xs font-semibold tabular-nums text-ink-soft">
        {formatDuration(p.currentTime)} / {formatDuration(max)}
      </span>
      <input
        type="range"
        aria-label="Seek"
        min={0}
        max={max}
        step={0.1}
        value={Math.min(p.currentTime, max)}
        disabled={!p.canControl || max === 0}
        onChange={(e) => p.onSeek(Number(e.target.value))}
        className="h-2 min-w-[6rem] flex-1 accent-[rgb(167_139_250)] disabled:opacity-60"
      />
      <IconButton label={p.muted || p.volume === 0 ? 'Unmute' : 'Mute'} onClick={p.onToggleMute}>
        {p.muted || p.volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </IconButton>
      <input
        type="range"
        aria-label="Volume"
        min={0}
        max={1}
        step={0.05}
        value={p.muted ? 0 : p.volume}
        onChange={(e) => p.onVolume(Number(e.target.value))}
        className="h-2 w-20 accent-[rgb(167_139_250)]"
      />
      <IconButton label="Toggle fullscreen" onClick={p.onFullscreen}>
        <Maximize size={18} />
      </IconButton>
    </div>
  );
}
