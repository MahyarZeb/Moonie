const STEPS = [
  { n: '1', emoji: '🏡', title: 'Make a room', text: 'Name it, pick a theme, choose your avatar. No account needed.' },
  { n: '2', emoji: '💌', title: 'Send the invite', text: 'Copy the link or the 6-letter code and send it to your people.' },
  { n: '3', emoji: '🍿', title: 'Watch, play & chill', text: 'Pick a video, share a screen, play a game and chat while you do it.' },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6">
      <h2 className="text-center text-3xl sm:text-4xl">How it works 🌙</h2>
      <ol className="mt-10 grid gap-6 md:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.n} className="card-soft relative p-6 pt-9 text-center">
            <span className="absolute -top-4 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full bg-gradient-to-br from-pink to-lavender font-display font-bold text-[rgb(61_44_92)] shadow-soft">
              {s.n}
            </span>
            <div className="text-4xl" aria-hidden>
              {s.emoji}
            </div>
            <h3 className="mt-3 text-xl">{s.title}</h3>
            <p className="mt-1.5 text-ink-soft">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
