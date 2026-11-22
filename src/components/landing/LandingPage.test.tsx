// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RoomProvider } from '@/lib/room/RoomProvider';
import { ThemeProvider } from '@/lib/theme/useTheme';
import { ToastProvider } from '@/components/ui/Toast';
import { FakeTransport } from '@/test/fakeTransport';
import { HERO_HEADING, HERO_SUBTITLE } from './Hero';
import { LandingPage } from './LandingPage';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

beforeAll(() => {
  // jsdom lacks IntersectionObserver, which motion's whileInView uses.
  globalThis.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
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
  push.mockClear();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(cleanup);

function mount(transport = new FakeTransport()) {
  render(
    <ThemeProvider>
      <ToastProvider>
        <RoomProvider transport={transport}>
          <LandingPage />
        </RoomProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
  return transport;
}

describe('landing page', () => {
  it('shows the exact hero heading and subtitle from the brief', () => {
    mount();
    expect(HERO_HEADING).toBe('Your little corner of the internet to watch, play & chill together.');
    expect(HERO_SUBTITLE).toBe('Grab your favorite people, pick something to watch, and make memories together.');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(HERO_HEADING);
    expect(screen.getByText(HERO_SUBTITLE)).toBeTruthy();
  });

  it('creates a room and navigates to /room/CODE', async () => {
    const transport = mount();
    fireEvent.click(screen.getAllByRole('button', { name: /Create room/i })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dialog.querySelector('input[placeholder="Friday movie night"]')!, { target: { value: 'Movie night' } });
    fireEvent.change(dialog.querySelector('input[placeholder="Mochi"]')!, { target: { value: 'Mochi' } });
    fireEvent.click(dialog.querySelector('button[type="submit"]')!);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/room/ABCD23'));
    expect(transport.creates[0]).toMatchObject({ name: 'Movie night', displayName: 'Mochi', theme: 'strawberry' });
    expect(transport.creates[0].password).toBeUndefined();
  });

  it('validates the create form before sending anything', async () => {
    const transport = mount();
    fireEvent.click(screen.getAllByRole('button', { name: /Create room/i })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(dialog.querySelector('button[type="submit"]')!);
    expect((await screen.findByRole('alert')).textContent).toMatch(/name your room|Give your room a name/);
    expect(transport.creates).toHaveLength(0);
  });

  it('join accepts a code or an invite URL and rejects garbage', async () => {
    mount();
    fireEvent.click(screen.getAllByRole('button', { name: /Join room/i })[0]);
    const dialog = await screen.findByRole('dialog');
    const input = dialog.querySelector('input')!;
    fireEvent.change(input, { target: { value: 'nonsense' } });
    fireEvent.click(dialog.querySelector('button[type="submit"]')!);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'https://moonie.example/room/abcd23?x=1' } });
    fireEvent.click(dialog.querySelector('button[type="submit"]')!);
    expect(push).toHaveBeenCalledWith('/room/ABCD23');
  });
});
