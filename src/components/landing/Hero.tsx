'use client';

import { motion, useReducedMotion } from 'motion/react';
import { LogIn, Play, Plus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FloatingDecor } from './FloatingDecor';

export const HERO_HEADING = 'Your little corner of the internet to watch, play & chill together.';
export const HERO_SUBTITLE = 'Grab your favorite people, pick something to watch, and make memories together.';

export function Hero({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  const reduce = useReducedMotion();
  const rise = (delay: number) =>
    reduce
      ? {}
      : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.6, ease: 'easeOut' as const } };

  return (
    <section className="relative isolate overflow-hidden">
      <FloatingDecor />
      <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <motion.span
            {...rise(0)}
            className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-surface/80 px-3.5 py-1.5 text-sm font-bold text-ink-soft shadow-soft"
          >
            <Sparkles size={15} className="text-purple" aria-hidden /> No sign-up. No downloads. Just vibes.
          </motion.span>
          <motion.h1 {...rise(0.08)} className="text-4xl leading-[1.12] sm:text-5xl lg:text-6xl">
            {HERO_HEADING}
          </motion.h1>
          <motion.p {...rise(0.16)} className="mt-5 max-w-xl text-lg text-ink-soft sm:text-xl">
            {HERO_SUBTITLE}
          </motion.p>
          <motion.div {...rise(0.24)} className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" icon={<Plus size={20} />} onClick={onCreate}>
              Create Room
            </Button>
            <Button size="lg" variant="secondary" icon={<LogIn size={20} />} onClick={onJoin}>
              Join Room
            </Button>
          </motion.div>
        </div>

        <motion.div {...rise(0.2)} className="relative mx-auto w-full max-w-md" aria-hidden>
          <div className="card-soft rotate-2 p-4">
            <div className="stage-backdrop relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl">
              <span className="absolute left-4 top-3 text-2xl">🌙</span>
              <span className="absolute bottom-3 right-4 text-2xl">✨</span>
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface/90 text-purple shadow-soft">
                <Play size={28} fill="currentColor" />
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div className="flex -space-x-2">
                {['🐱', '🐰', '🦊', '🐼'].map((e) => (
                  <span key={e} className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-surface bg-gradient-to-br from-pink/60 to-sky/60 text-lg">
                    {e}
                  </span>
                ))}
              </div>
              <span className="rounded-full bg-pink/40 px-3 py-1 text-xs font-bold">4 friends hanging out</span>
            </div>
          </div>
          <div className="card-soft absolute -bottom-6 -left-2 -rotate-3 px-4 py-2 text-sm font-bold sm:-left-8">💬 this part is so good!!</div>
        </motion.div>
      </div>
    </section>
  );
}
