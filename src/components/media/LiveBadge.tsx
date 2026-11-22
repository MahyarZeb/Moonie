import { Badge } from '@/components/ui/Badge';

/** A pulsing "LIVE" pill shown while a screen is being shared. */
export function LiveBadge({ label = 'LIVE' }: { label?: string }) {
  return (
    <Badge tone="pink" role="status">
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[rgb(220_70_110)] opacity-70" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[rgb(220_70_110)]" />
      </span>
      {label}
    </Badge>
  );
}
