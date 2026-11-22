'use client';

import { motion, useReducedMotion } from 'motion/react';
import { Gamepad2, MessageCircleHeart, MonitorUp, Palette, PlayCircle, FileVideo } from 'lucide-react';
import type { ReactNode } from 'react';

const FEATURES: { icon: ReactNode; title: string; text: string; tint: string }[] = [
  {
    icon: <PlayCircle size={26} />,
    title: 'Watch YouTube together',
    text: 'Paste a link and everyone stays in sync. Play, pause and seek together, and line up a shared queue.',
    tint: 'from-pink/50 to-pink/10',
  },
  {
    icon: <MonitorUp size={26} />,
    title: 'Share your screen',
    text: 'Stream a tab, a window or your whole screen straight to friends, peer to peer.',
    tint: 'from-sky/60 to-sky/10',
  },
  {
    icon: <FileVideo size={26} />,
    title: 'Local video files',
    text: 'Drop in a video from your device. Everyone picks the same file, or the host streams it live.',
    tint: 'from-lavender/60 to-lavender/10',
  },
  {
    icon: <MessageCircleHeart size={26} />,
    title: 'Live chat',
    text: 'Cute bubbles, emoji, typing hints and join notes, all in real time.',
    tint: 'from-purple/40 to-purple/10',
  },
  {
    icon: <Gamepad2 size={26} />,
    title: 'Cozy games',
    text: 'Ludo, Tic-Tac-Toe and Rock Paper Scissors right inside your room.',
    tint: 'from-pink/40 to-sky/20',
  },
  {
    icon: <Palette size={26} />,
    title: 'Dreamy room themes',
    text: 'Pick a mood for your sleepover: strawberry, lavender, cloud, vanilla, starlight or bubblegum.',
    tint: 'from-sky/40 to-lavender/20',
  },
];

export function FeatureCards() {
  const reduce = useReducedMotion();
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6">
      <h2 className="text-center text-3xl sm:text-4xl">Everything for a cozy hangout 🎀</h2>
      <p className="mx-auto mt-2 max-w-xl text-center text-ink-soft">One room, all the little things that make hanging out online feel close.</p>
      <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <motion.li
            key={f.title}
            initial={reduce ? false : { opacity: 0, y: 20 }}
            whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ delay: (i % 3) * 0.08, duration: 0.5 }}
            className="card-soft group p-6 transition duration-300 hover:-translate-y-1.5 hover:shadow-glow"
          >
            <span className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${f.tint} text-ink`}>{f.icon}</span>
            <h3 className="text-xl">{f.title}</h3>
            <p className="mt-1.5 text-ink-soft">{f.text}</p>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
