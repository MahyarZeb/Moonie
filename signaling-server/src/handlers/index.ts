import type { ClientMessage } from '../../../shared/protocol';
import { Conn, type HandlerContext } from '../connection';
import { handleCreate, handleJoin, handlePeek } from './lobby';
import { handleLocalReady, handleMediaEnded, handleMediaError, handleMediaSet } from './media';
import { handlePlayback } from './playback';
import { handleQueueAdd, handleQueuePlay, handleQueueRemove, handleQueueReorder } from './queue';
import { handleRtcSignal, handleShareStart, handleShareStop } from './share';
import { handleKick, handleLeave, handlePing, handleProfile, handleSettings, handleTransfer } from './room';

/** Routes one validated client message. Later phases add cases for media, chat, games and rtc. */
export async function dispatch(ctx: HandlerContext, conn: Conn, msg: ClientMessage): Promise<void> {
  switch (msg.type) {
    case 'room:peek':
      return handlePeek(ctx, conn, msg);
    case 'room:create':
      return handleCreate(ctx, conn, msg);
    case 'room:join':
      return handleJoin(ctx, conn, msg);
    case 'sync:ping':
      return handlePing(ctx, conn, msg);
    case 'room:leave':
      return handleLeave(ctx, conn);
  }

  const { room, pid } = conn;
  if (!room || !pid) return conn.error('invalid_state', 'Join a room first', msg.ref);
  if (!room.participants.has(pid)) {
    conn.room = null;
    conn.pid = null;
    return conn.error('invalid_state', 'You are no longer in this room', msg.ref);
  }
  room.touch();

  switch (msg.type) {
    case 'profile:update':
      return handleProfile(ctx, room, pid, msg);
    case 'room:settings':
      return handleSettings(ctx, conn, room, pid, msg);
    case 'host:transfer':
      return handleTransfer(conn, room, pid, msg);
    case 'host:kick':
      return handleKick(conn, room, pid, msg);
    case 'media:set':
      return handleMediaSet(conn, room, pid, msg);
    case 'local:ready':
      return handleLocalReady(room, pid, msg);
    case 'media:ended':
      return handleMediaEnded(conn, room, pid, msg);
    case 'media:error':
      return handleMediaError(conn, room, pid, msg);
    case 'playback:command':
      return handlePlayback(conn, room, pid, msg);
    case 'queue:add':
      return handleQueueAdd(conn, room, pid, msg);
    case 'queue:remove':
      return handleQueueRemove(conn, room, pid, msg);
    case 'queue:reorder':
      return handleQueueReorder(conn, room, pid, msg);
    case 'queue:play':
      return handleQueuePlay(conn, room, pid, msg);
    case 'share:start':
      return handleShareStart(conn, room, pid, msg);
    case 'share:stop':
      return handleShareStop(conn, room, pid, msg);
    case 'rtc:signal':
      return handleRtcSignal(ctx, room, pid, msg);
    default:
      return conn.error('bad_request', 'This message is not supported yet', msg.ref);
  }
}
