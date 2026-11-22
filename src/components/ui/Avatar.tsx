import { AVATAR_EMOJI } from '@shared/constants';
import type { AvatarId } from '@shared/protocol';
import { cn } from '@/lib/utils/cn';

const sizes = { sm: 'h-7 w-7 text-base', md: 'h-10 w-10 text-xl', lg: 'h-14 w-14 text-3xl' } as const;

export function Avatar({
  avatar,
  size = 'md',
  dim = false,
  className,
}: {
  avatar: AvatarId;
  size?: keyof typeof sizes;
  /** Dims the avatar, used for participants who are reconnecting. */
  dim?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pink/60 to-sky/60 shadow-sm',
        sizes[size],
        dim && 'opacity-50 grayscale',
        className,
      )}
    >
      {AVATAR_EMOJI[avatar]}
    </span>
  );
}
