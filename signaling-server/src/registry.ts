import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../shared/constants';
import type { ThemeId } from '../../shared/protocol';
import type { Logger } from './log';
import { nullMetadata, type MetadataResolver } from './metadata';
import { PasswordGuard } from './rateLimit';
import { Room, type Clock, type RoomOptions } from './room';

export type CreateResult = { ok: true; room: Room } | { ok: false; code: 'server_busy'; message: string };

/** All live rooms, in memory only. */
export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  readonly passwordGuard = new PasswordGuard();

  constructor(
    private readonly clock: Clock,
    private readonly opts: RoomOptions & { maxRooms: number },
    private readonly log: Logger,
    private readonly pickIndex: (max: number) => number = (max) => randomInt(max),
    private readonly metadata: MetadataResolver = nullMetadata,
  ) {}

  get size(): number {
    return this.rooms.size;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  private generateCode(): string {
    let out = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) out += ROOM_CODE_ALPHABET[this.pickIndex(ROOM_CODE_ALPHABET.length)];
    return out;
  }

  /** Creates an empty room with a collision-checked code. */
  createRoom(name: string, theme: ThemeId): CreateResult {
    if (this.rooms.size >= this.opts.maxRooms) return { ok: false, code: 'server_busy', message: 'Moonie is full right now' };
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = this.generateCode();
      if (this.rooms.has(code)) continue;
      const room = new Room(code, name, theme, this.clock, this.opts, this.log, this.metadata);
      this.rooms.set(code, room);
      this.log.info('room created', { room: code });
      return { ok: true, room };
    }
    return { ok: false, code: 'server_busy', message: 'Could not allocate a room code' };
  }

  delete(code: string): void {
    if (this.rooms.delete(code)) {
      this.passwordGuard.clearRoom(code);
      this.log.info('room destroyed', { room: code });
    }
  }

  /** Runs every room's deadlines. */
  sweep(): void {
    const now = this.clock.now();
    for (const [code, room] of [...this.rooms]) {
      let remove = false;
      try {
        remove = room.sweep();
      } catch (err) {
        this.log.error('room sweep failed', { room: code, error: String(err) });
      }
      if (remove) this.delete(code);
    }
    this.passwordGuard.sweep(now);
  }

  /** Closes every room (used on shutdown). */
  closeAll(): void {
    for (const room of this.rooms.values()) room.closeAll('expired');
    this.rooms.clear();
  }
}
