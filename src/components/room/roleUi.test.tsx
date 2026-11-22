// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/permissions';
import type { ChatMessage, Participant, QueueItem, Role, RoomSnapshot, ServerMessage } from '@shared/protocol';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { AddVideoBar } from '@/components/media/AddVideoBar';
import { QueuePanel } from '@/components/media/QueuePanel';
import { ToastProvider } from '@/components/ui/Toast';
import { RoomProvider } from '@/lib/room/RoomProvider';
import { ThemeProvider } from '@/lib/theme/useTheme';
import { FakeTransport, makeSnapshot } from '@/test/fakeTransport';
import { ParticipantList } from './ParticipantList';
import { ReactionBar, ReactionLayer } from './ReactionBar';
import { SettingsDialog } from './SettingsDialog';

beforeAll(() => {
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
});
afterEach(cleanup);

const person = (id: string, role: Role, extra: Partial<Participant> = {}): Participant => ({
  id,
  name: id.toUpperCase(),
  avatar: 'cat',
  joinedAt: 1,
  connected: true,
  role,
  ...extra,
});
const item = (id: string, addedBy: string): QueueItem => ({ id, videoId: 'dQw4w9WgXcQ', title: `Video ${id}`, addedBy, addedAt: 1 });

/** Mounts `children` inside a joined room where the caller is `selfId`. */
async function mount(selfId: string, over: Partial<RoomSnapshot>, children: React.ReactNode) {
  const transport = new FakeTransport();
  const snapshot: RoomSnapshot = {
    ...makeSnapshot(),
    hostId: 'h',
    participants: [person('h', 'host'), person('c', 'co_host'), person('m', 'member'), person('n', 'member')],
    ...over,
  };
  render(
    <ThemeProvider>
      <ToastProvider>
        <RoomProvider transport={transport}>{children}</RoomProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
  const joined: ServerMessage = { type: 'room:joined', selfId, resumeToken: 't', snapshot, resumed: true };
  await act(async () => transport.emit(joined));
  return transport;
}
const sentOf = (t: FakeTransport, type: string) => t.sent.filter((m) => m.type === type);

describe('Add video box', () => {
  it('says "Suggest video" and explains approval to members', async () => {
    await mount('m', {}, <AddVideoBar />);
    expect(screen.getByRole('button', { name: /Suggest video/ })).toBeTruthy();
    expect(screen.getByText(/waits for a host to approve/)).toBeTruthy();
  });
  it('says "Add video" to co-hosts and to members when approval is off', async () => {
    await mount('c', {}, <AddVideoBar />);
    expect(screen.getByRole('button', { name: /Add video/ })).toBeTruthy();
    expect(screen.queryByText(/waits for a host/)).toBeNull();
    cleanup();
    await mount('m', { settings: { ...DEFAULT_SETTINGS, requireApproval: false } }, <AddVideoBar />);
    expect(screen.getByRole('button', { name: /Add video/ })).toBeTruthy();
  });
  it('confirms a suggestion with a toast', async () => {
    const t = await mount('m', {}, <AddVideoBar />);
    t.requestImpl = async () => ({ type: 'queue:updated', queue: [] });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } });
    fireEvent.click(screen.getByRole('button', { name: /Suggest video/ }));
    await waitFor(() => expect(screen.getByText('Suggestion sent')).toBeTruthy());
  });
});

describe('Queue panel', () => {
  it('lets a controller approve or reject a suggestion', async () => {
    const t = await mount('c', { suggestions: [item('s1', 'm')], queue: [item('q1', 'h')] }, <QueuePanel />);
    expect(screen.getByText('Suggestions')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(sentOf(t, 'queue:approve')).toEqual([{ type: 'queue:approve', itemId: 's1' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(sentOf(t, 'queue:remove')).toEqual([{ type: 'queue:remove', itemId: 's1' }]);
    expect(screen.getByRole('button', { name: 'Play now' })).toBeTruthy();
  });
  it('shows a member only their own suggestions, waiting, with a withdraw button and no controls', async () => {
    const t = await mount('m', { suggestions: [item('s1', 'm'), item('s2', 'n')], queue: [item('q1', 'h')] }, <QueuePanel />);
    expect(screen.getByText('Waiting for approval', { selector: 'h3' })).toBeTruthy();
    expect(screen.getAllByRole('listitem').filter((li) => li.getAttribute('aria-label') === 'Video s1')).toHaveLength(1);
    expect(screen.queryByText('Video s2')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Play now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move up' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(sentOf(t, 'queue:remove')).toEqual([{ type: 'queue:remove', itemId: 's1' }]);
  });
  it('lets a member remove only their own queued video', async () => {
    await mount('m', { queue: [item('q1', 'h'), item('q2', 'm')] }, <QueuePanel />);
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
  });
});

describe('Participant panel', () => {
  it('shows crown and star badges and asks before promoting', async () => {
    const t = await mount('h', {}, <ParticipantList />);
    expect(screen.getByText('Host')).toBeTruthy();
    expect(screen.getByText('Co-host')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Promote M to co-host' }));
    expect(sentOf(t, 'role:set')).toHaveLength(0);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Promote' }));
    expect(sentOf(t, 'role:set')).toEqual([{ type: 'role:set', to: 'm', role: 'co_host' }]);
  });
  it('cancel sends nothing; transfer and remove co-host also confirm first', async () => {
    const t = await mount('h', {}, <ParticipantList />);
    fireEvent.click(screen.getByRole('button', { name: 'Make C the host' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(t.sent).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Remove C as co-host' }));
    expect(sentOf(t, 'role:set')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Remove co-host' }));
    expect(sentOf(t, 'role:set')).toEqual([{ type: 'role:set', to: 'c', role: 'member' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Make M the host' }));
    fireEvent.click(screen.getByRole('button', { name: 'Transfer host' }));
    expect(sentOf(t, 'host:transfer')).toEqual([{ type: 'host:transfer', to: 'm' }]);
  });
  it('gives a co-host mute and remove for members only, and no role actions', async () => {
    await mount('c', {}, <ParticipantList />);
    expect(screen.getByRole('button', { name: 'Mute M' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove M from the room' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Promote/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /the host/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mute H' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mute C|Remove C/ })).toBeNull();
  });
  it('hides remove from co-hosts when the host turns it off', async () => {
    await mount('c', { settings: { ...DEFAULT_SETTINGS, coHostsCanKick: false } }, <ParticipantList />);
    expect(screen.queryByRole('button', { name: 'Remove M from the room' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mute M' })).toBeTruthy();
  });
  it('gives a member no management buttons', async () => {
    await mount('m', {}, <ParticipantList />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
  it('mutes with one click and shows the muted mark', async () => {
    const t = await mount('h', { participants: [person('h', 'host'), person('m', 'member', { muted: true })] }, <ParticipantList />);
    expect(screen.getByLabelText('Muted')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unmute M' }));
    expect(sentOf(t, 'chat:mute')).toEqual([{ type: 'chat:mute', id: 'm', muted: false }]);
  });
});

describe('Chat moderation', () => {
  const msg = (id: string, from: string): ChatMessage => ({ id, kind: 'user', from, name: from, text: `hello ${id}`, ts: 1 });
  const sys: ChatMessage = { id: 'sys', kind: 'system', text: 'someone joined', ts: 1 };

  it('lets the host delete anyone else\'s message but not system lines or its own', async () => {
    const t = await mount('h', { chat: [msg('a', 'm'), msg('b', 'c'), msg('own', 'h'), sys] }, <ChatPanel />);
    expect(screen.getAllByRole('button', { name: 'Delete message' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete message' })[0]!);
    expect(sentOf(t, 'chat:delete')).toEqual([{ type: 'chat:delete', messageId: 'a' }]);
  });
  it('lets a co-host delete members\' messages only', async () => {
    await mount('c', { chat: [msg('a', 'm'), msg('b', 'h'), msg('d', 'c')] }, <ChatPanel />);
    expect(screen.getAllByRole('button', { name: 'Delete message' })).toHaveLength(1);
  });
  it('gives members no delete buttons', async () => {
    await mount('m', { chat: [msg('a', 'n')] }, <ChatPanel />);
    expect(screen.queryByRole('button', { name: 'Delete message' })).toBeNull();
  });
  it('disables the message box for a muted member', async () => {
    await mount('m', { participants: [person('h', 'host'), person('m', 'member', { muted: true })] }, <ChatPanel />);
    expect((screen.getByLabelText('Message') as HTMLInputElement).disabled).toBe(true);
  });
  it('removes a deleted message when the server says so', async () => {
    const t = await mount('m', { chat: [msg('a', 'n')] }, <ChatPanel />);
    expect(screen.getByText('hello a')).toBeTruthy();
    await act(async () => t.emit({ type: 'chat:deleted', id: 'a' }));
    expect(screen.queryByText('hello a')).toBeNull();
  });
});

describe('Notices, reactions and settings', () => {
  it('toasts who added or suggested a video', async () => {
    const t = await mount('h', {}, <AddVideoBar />);
    await act(async () =>
      t.emit({ type: 'queue:notice', kind: 'suggested', itemId: 'x', videoId: 'dQw4w9WgXcQ', title: 'Cute cats', by: 'Mia' }),
    );
    expect(screen.getByText('Mia suggested "Cute cats"')).toBeTruthy();
    await act(async () => t.emit({ type: 'queue:notice', kind: 'added', itemId: 'y', videoId: 'dQw4w9WgXcQ', by: 'Bo' }));
    expect(screen.getByText('Bo added a video')).toBeTruthy();
  });
  it('sends a reaction and floats incoming ones', async () => {
    const t = await mount('m', {}, <><ReactionBar /><ReactionLayer /></>);
    const buttons = screen.getAllByRole('button', { name: /^React / });
    expect(buttons).toHaveLength(6);
    fireEvent.click(buttons[0]!);
    expect(sentOf(t, 'reaction:send')).toHaveLength(1);
    await act(async () => t.emit({ type: 'reaction', from: 'n', emoji: '\u{1F525}' }));
    expect(screen.getAllByText('\u{1F525}').length).toBeGreaterThan(1);
  });
  it('lets the host flip a room rule and shows the rules read-only to others', async () => {
    const t = await mount('h', {}, <SettingsDialog open onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/Auto-play next video/));
    expect(sentOf(t, 'room:settings')).toEqual([{ type: 'room:settings', autoNext: false }]);
    cleanup();
    await mount('c', {}, <SettingsDialog open onClose={() => {}} />);
    expect((screen.getByLabelText(/Auto-play next video/) as HTMLInputElement).disabled).toBe(true);
  });
});