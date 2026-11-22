'use client';

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getTransport } from '@/lib/signaling';
import type { SignalingTransport } from '@/lib/signaling/types';
import { useToast } from '@/components/ui/Toast';
import { RoomController } from './RoomController';
import { initialRoomState, type RoomClientState } from './reducer';
import { createRoomStore } from './roomStore';

const RoomContext = createContext<RoomController | null>(null);

/** Owns the transport and the room store for the whole tab. Sits in the root layout so it survives route changes. */
export function RoomProvider({ children, transport }: { children: ReactNode; transport?: SignalingTransport }) {
  const [controller] = useState(() => new RoomController(() => transport ?? getTransport(), createRoomStore()));

  useEffect(() => controller.start(), [controller]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (Object.keys(controller.store.getState().typing).length > 0) {
        controller.store.dispatch({ type: 'typing-expire', now: Date.now() });
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [controller]);

  return (
    <RoomContext.Provider value={controller}>
      <ErrorToaster controller={controller} />
      {children}
    </RoomContext.Provider>
  );
}

/** Shows server and client errors that have no inline home as toasts. */
function ErrorToaster({ controller }: { controller: RoomController }) {
  const toast = useToast();
  const lastError = useSyncExternalStore(
    controller.store.subscribe,
    () => controller.store.getState().lastError,
    () => undefined,
  );
  useEffect(() => {
    if (!lastError) return;
    toast.show(lastError.message, 'error');
    controller.store.dispatch({ type: 'clear-error' });
  }, [lastError, toast, controller]);
  return null;
}

export function useRoomController(): RoomController {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoomController must be used inside RoomProvider');
  return ctx;
}

/** Subscribes to a slice of the room store. Selectors must return stable references. */
export function useRoom<T>(selector: (state: RoomClientState) => T): T {
  const { store } = useRoomController();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(initialRoomState),
  );
}
