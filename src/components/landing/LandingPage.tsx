'use client';

import { useCallback, useState } from 'react';
import { CreateRoomModal } from './CreateRoomModal';
import { FeatureCards } from './FeatureCards';
import { Footer } from './Footer';
import { Hero } from './Hero';
import { HowItWorks } from './HowItWorks';
import { JoinRoomModal } from './JoinRoomModal';
import { Navbar } from './Navbar';

export function LandingPage() {
  const [modal, setModal] = useState<'create' | 'join' | null>(null);
  const close = useCallback(() => setModal(null), []);
  return (
    <>
      <Navbar onCreate={() => setModal('create')} onJoin={() => setModal('join')} />
      <main>
        <Hero onCreate={() => setModal('create')} onJoin={() => setModal('join')} />
        <FeatureCards />
        <HowItWorks />
      </main>
      <Footer />
      <CreateRoomModal open={modal === 'create'} onClose={close} />
      <JoinRoomModal open={modal === 'join'} onClose={close} />
    </>
  );
}
