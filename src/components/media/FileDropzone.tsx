'use client';

import { useId, useRef, useState, type DragEvent } from 'react';
import { FileVideo, UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { ACCEPT } from '@/lib/localfile/support';

interface Props {
  onFile: (file: File) => void;
  title?: string;
  disabled?: boolean;
}

/** Click-to-pick and drag-and-drop area for one video file. The file stays on this device. */
export function FileDropzone({ onFile, title = 'Drop a video here or click to browse', disabled = false }: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed p-6 text-center transition',
        over ? 'border-purple bg-lavender/40' : 'border-lavender/70 bg-surface-2',
        disabled && 'opacity-60',
      )}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-lavender/50" aria-hidden>
        {over ? <FileVideo size={22} /> : <UploadCloud size={22} />}
      </span>
      <label htmlFor={inputId} className="cursor-pointer font-bold">
        {title}
      </label>
      <p className="text-xs text-ink-soft">MP4, WebM or MOV (MOV depends on your browser)</p>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPT}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = ''; // allow picking the same file again
        }}
      />
    </div>
  );
}
