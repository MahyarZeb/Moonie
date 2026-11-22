// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { saveIdentity, writeSession } from '@/lib/identity/identity';
import { RoomProvider } from '@/lib/room/RoomProvider';
import { ThemeProvider } from '@/lib/theme/useTheme';
import { ToastProvider } from '@/components/ui/Toast';
import { FakeTransport } from '@/test/fakeTransport';
import { RoomShell } from './RoomShell';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

beforeAll(() => {
  // jsdom has no matchMedia or scrollIntoView.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  saveIdentity({ displayName: 'Mochi', avatar: 'cat' });
});
afterEach(cleanup);

function mount(transport: FakeTransport, code = 'ABCD23') {
  return render(
    <StrictMode>
      <ThemeProvider>
        <ToastProvider>
          <RoomProvider transport={transport}>
            <RoomShell code={code} />
          </RoomProvider>
        </ToastProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('RoomShell under React Strict Mode', () => {
  it('sends exactly one resume room:join and one room:leave', async () => {
    writeSession({ code: 'ABCD23', resumeToken: 'old' });
    const transport = new FakeTransport();
    const view = mount(transport);
    await waitFor(() => expect(screen.getByRole('heading', { name: /Test room/ })).toBeTruthy());
    expect(transport.joins).toHaveLength(1);
    expect(transport.joins[0].resumeToken).toBe('old');
    expect(transport.peeks).toHaveLength(0);
    expect(transport.leaves).toBe(0);

    view.unmount();
    await settle();
    expect(transport.leaves).toBe(1);
    expect(transport.joins).toHaveLength(1);
  });

  it('peeks once and shows the lobby for a guest', async () => {
    const transport = new FakeTransport();
    const view = mount(transport);
    await waitFor(() => expect(screen.getByRole('button', { name: /Enter room/ })).toBeTruthy());
    expect(transport.peeks).toEqual(['ABCD23']);
    expect(transport.joins).toHaveLength(0);
    view.unmount();
    await settle();
    expect(transport.joins).toHaveLength(0);
  });

  it('ignores invalid_state on resume and does not peek or leave', async () => {
    writeSession({ code: 'ABCD23', resumeToken: 'old' });
    const transport = new FakeTransport();
    const { TransportError } = await import('@/lib/signaling/types');
    transport.joinError = new TransportError('invalid_state', 'already joined');
    mount(transport);
    await settle();
    expect(transport.joins).toHaveLength(1);
    expect(transport.peeks).toHaveLength(0);
    expect(transport.leaves).toBe(0);
  });

  it('shows the not-found card when the room does not exist', async () => {
    const transport = new FakeTransport();
    const { TransportError } = await import('@/lib/signaling/types');
    transport.peekError = new TransportError('not_found', 'Room not found');
    mount(transport);
    await waitFor(() => expect(screen.getByText('Room not found')).toBeTruthy());
  });
});
