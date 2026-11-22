'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { TransportError } from '@/lib/signaling/types';
import { parseYouTubeUrl, type ParsedYouTube } from '@/lib/youtube/parse';

export interface UrlFormAction {
  label: string;
  icon?: ReactNode;
  variant?: 'primary' | 'secondary';
  run: (parsed: ParsedYouTube) => Promise<void>;
}

/** A URL box with parse feedback and one or more submit actions. The first action is the form default. */
export function YouTubeUrlForm({ actions, placeholder }: { actions: UrlFormAction[]; placeholder?: string }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const uid = useId();

  const submit = async (index: number) => {
    const parsed = parseYouTubeUrl(value);
    if (!parsed) {
      setError('That does not look like a YouTube link. Try a watch, youtu.be or Shorts link.');
      return;
    }
    setError(null);
    setBusy(index);
    try {
      await actions[index]!.run(parsed);
      setValue('');
    } catch (err) {
      setError(err instanceof TransportError ? err.message : 'Something went wrong, please try again.');
    } finally {
      setBusy(null);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(0);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <label className="sr-only" htmlFor={`${uid}-url`}>
        YouTube link
      </label>
      <input
        id={`${uid}-url`}
        className="input-soft"
        placeholder={placeholder ?? 'Paste a YouTube link'}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${uid}-err` : undefined}
        autoComplete="off"
        spellCheck={false}
      />
      {error && (
        <p id={`${uid}-err`} role="alert" className="text-sm font-semibold text-[rgb(190_60_110)] dark:text-pink">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {actions.map((a, i) => (
          <Button
            key={a.label}
            type={i === 0 ? 'submit' : 'button'}
            size="sm"
            variant={a.variant ?? (i === 0 ? 'primary' : 'secondary')}
            icon={a.icon}
            loading={busy === i}
            disabled={busy !== null || !value.trim()}
            onClick={i === 0 ? undefined : () => void submit(i)}
          >
            {a.label}
          </Button>
        ))}
      </div>
    </form>
  );
}
