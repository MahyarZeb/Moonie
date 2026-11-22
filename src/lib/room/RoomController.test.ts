// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearSession, readSession, saveIdentity, writeSession } from '@/lib/identity/identity';
import { TransportError } from '@/lib/signaling/types';
import { FakeTransport } from '@/test/fakeTransport';
import { RoomController } from './RoomController';
import { createRoomStore } from './roomStore';

function setup() {
  const transport = new FakeTransport();
  const controller = new RoomController(() => transport, createRoomStore());
  const stop = controller.start();
  return { transport, controller, store: controller.store, stop };
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  saveIdentity({ displayName: 'Mochi', avatar: 'cat' });
});

describe('identity storage', () => {
  it('round-trips the session and clears it', () => {
    expect(readSession()).toBeNull();
    writeSession({ code: 'ABCD23', resumeToken: 'tok' });
    expect(readSession()).toEqual({ code: 'ABCD23', resumeToken: 'tok' });
    clearSession();
    expect(readSession()).toBeNull();
  });
  it('ignores corrupt session data', () => {
    window.sessionStorage.setItem('moonie-session', '{nope');
    expect(readSession()).toBeNull();
  });
});

describe('RoomController.open', () => {
  it('peeks when there is no stored session', async () => {
    const { controller, store, transport } = setup();
    await controller.open('ABCD23');
    expect(transport.peeks).toEqual(['ABCD23']);
    expect(store.getState().phase).toBe('lobby');
    expect(store.getState().peek?.name).toBe('Test room');
  });

  it('tries the stored session first and lands inside the room on success', async () => {
    writeSession({ code: 'ABCD23', resumeToken: 'old' });
    const { controller, store, transport } = setup();
    await controller.open('ABCD23');
    expect(transport.joins).toHaveLength(1);
    expect(transport.joins[0]).toMatchObject({ code: 'ABCD23', resumeToken: 'old', displayName: 'Mochi' });
    expect(transport.peeks).toHaveLength(0);
    expect(store.getState()).toMatchObject({ phase: 'in-room', entered: true });
    expect(readSession()?.resumeToken).toBe('tok-join'); // rewritten on every room:joined
  });

  it('clears the session and falls back to the lobby when the resume fails', async () => {
    writeSession({ code: 'ABCD23', resumeToken: 'old' });
    const { controller, store, transport } = setup();
    transport.joinError = new TransportError('not_found', 'gone');
    await controller.open('ABCD23');
    expect(readSession()).toBeNull();
    expect(transport.peeks).toEqual(['ABCD23']);
    expect(store.getState().phase).toBe('lobby');
  });

  it('ignores invalid_state as the reply to a resume (already joined)', async () => {
    writeSession({ code: 'ABCD23', resumeToken: 'old' });
    const { controller, store, transport } = setup();
    transport.joinError = new TransportError('invalid_state', 'already');
    await controller.open('ABCD23');
    expect(readSession()).toEqual({ code: 'ABCD23', resumeToken: 'old' });
    expect(transport.peeks).toHaveLength(0);
    expect(store.getState().phase).toBe('joining');
  });

  it('clears a stored session that belongs to another room', async () => {
    writeSession({ code: 'ZZZZ22', resumeToken: 'old' });
    const { controller, transport } = setup();
    await controller.open('ABCD23');
    expect(readSession()).toBeNull();
    expect(transport.joins).toHaveLength(0);
  });

  it('reports peek failures as a lobby error', async () => {
    const { controller, store, transport } = setup();
    transport.peekError = new TransportError('not_found', 'Room not found');
    await controller.open('ABCD23');
    expect(store.getState().peekError?.code).toBe('not_found');
  });

  it('leaves the old room before opening another one', async () => {
    const { controller, store, transport } = setup();
    await controller.open('ABCD23');
    await controller.joinRoom({ code: 'ABCD23', displayName: 'Mochi', avatar: 'cat' });
    expect(store.getState().phase).toBe('in-room');
    await controller.open('ZZZZ22');
    expect(transport.leaves).toBe(1);
    expect(transport.peeks.at(-1)).toBe('ZZZZ22');
  });
});

describe('RoomController create, join and leave', () => {
  it('create lands in the lobby (entered false) and enter flips it', async () => {
    const { controller, store } = setup();
    const code = await controller.createRoom({ name: 'R', theme: 'cloud', displayName: 'Mochi', avatar: 'cat' });
    expect(code).toBe('ABCD23');
    expect(store.getState()).toMatchObject({ phase: 'in-room', entered: false });
    controller.enter();
    expect(store.getState().entered).toBe(true);
  });

  it('a failed join returns to the lobby and rethrows', async () => {
    const { controller, store, transport } = setup();
    await controller.open('ABCD23');
    transport.joinError = new TransportError('wrong_password', 'nope');
    await expect(controller.joinRoom({ code: 'ABCD23', displayName: 'M', avatar: 'cat', password: 'x' })).rejects.toMatchObject({
      code: 'wrong_password',
    });
    expect(store.getState().phase).toBe('lobby');
  });

  it('leave is idempotent and clears the session', async () => {
    const { controller, store, transport } = setup();
    await controller.open('ABCD23');
    await controller.joinRoom({ code: 'ABCD23', displayName: 'M', avatar: 'cat' });
    controller.leave();
    controller.leave();
    expect(transport.leaves).toBe(1);
    expect(readSession()).toBeNull();
    expect(store.getState().phase).toBe('idle');
  });

  it('clears the stored session on kicked and room:closed', async () => {
    const { controller, transport } = setup();
    await controller.joinRoom({ code: 'ABCD23', displayName: 'M', avatar: 'cat' });
    expect(readSession()).not.toBeNull();
    transport.emit({ type: 'kicked' });
    expect(readSession()).toBeNull();
    await controller.joinRoom({ code: 'ABCD23', displayName: 'M', avatar: 'cat' });
    transport.emit({ type: 'room:closed', reason: 'expired' });
    expect(readSession()).toBeNull();
  });

  it('beginAttempt is false for the same code until the attempt is cleared', () => {
    const { controller } = setup();
    expect(controller.beginAttempt('ABCD23')).toBe(true);
    expect(controller.beginAttempt('ABCD23')).toBe(false);
    expect(controller.beginAttempt('ZZZZ22')).toBe(true);
  });
});
