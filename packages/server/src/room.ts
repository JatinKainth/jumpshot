import {
  INPUT_IDLE_TIMEOUT_MS,
  LEVELS,
  MAX_PLAYERS,
  parseLevel,
  Sim,
  SNAPSHOT_RATE_HZ,
  STEP_DT,
  TICK_RATE_HZ,
  encodeMsg,
} from "@jumpshot/shared";
import type { PlayerSnapshot, ServerMsg } from "@jumpshot/shared";

const SNAP_EVERY = Math.round(TICK_RATE_HZ / SNAPSHOT_RATE_HZ);

interface Slot {
  slot: number;
  state: ReturnType<Sim["spawn"]>;
  bits: number;
  lastSeq: number;
  lastInputAt: number;
}

/**
 * Authoritative room state. Owns the fixed-step loop; the network layer feeds
 * it inputs and forwards its snapshots.
 */
export class Room {
  private readonly sim = new Sim(parseLevel(LEVELS[0]!));
  private readonly slots = new Map<number, Slot>();
  private readonly freeSlots: number[] = [];
  private broadcast: (msg: ServerMsg) => void = () => {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;
  private tick = 0;

  get full(): boolean {
    return this.slots.size >= MAX_PLAYERS;
  }

  onBroadcast(fn: (msg: ServerMsg) => void): void {
    this.broadcast = fn;
  }

  join(): { id: number; welcome: WelcomeMsgShape } {
    const slot = this.freeSlots.pop() ?? this.slots.size;
    const id = slot;
    this.slots.set(id, {
      slot,
      state: this.sim.spawn(slot),
      bits: 0,
      lastSeq: 0,
      lastInputAt: performance.now(),
    });
    if (this.timer === null) this.start();
    return { id, welcome: this.welcome(id) };
  }

  leave(id: number): void {
    const s = this.slots.get(id);
    if (!s) return;
    this.slots.delete(id);
    this.freeSlots.push(s.slot);
    this.freeSlots.sort((a, b) => b - a);
  }

  setInput(id: number, seq: number, bits: number): void {
    const s = this.slots.get(id);
    if (!s) return;
    s.bits = bits;
    s.lastSeq = seq;
    s.lastInputAt = performance.now();
  }

  private welcome(selfId: number): WelcomeMsgShape {
    return { t: "welcome", id: selfId, tick: this.tick, ps: this.snapshots() };
  }

  private snapshots(): PlayerSnapshot[] {
    const ps: PlayerSnapshot[] = [];
    for (const [id, s] of this.slots) {
      ps.push([
        id,
        round(s.state.x),
        round(s.state.y),
        round(s.state.vx),
        round(s.state.vy),
        s.state.facing,
        s.state.onGround ? 1 : 0,
        s.state.jumpHeldPrev ? 1 : 0,
      ]);
    }
    return ps;
  }

  private start(): void {
    this.last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      this.acc += now - this.last;
      this.last = now;
      while (this.acc >= STEP_DT * 1000) {
        this.stepOnce();
        this.acc -= STEP_DT * 1000;
      }
    }, 1);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private stepOnce(): void {
    const now = performance.now();
    for (const s of this.slots.values()) {
      if (now - s.lastInputAt > INPUT_IDLE_TIMEOUT_MS) s.bits = 0;
      this.sim.step(s.state, s.bits);
    }
    this.tick++;
    if (this.tick % SNAP_EVERY === 0) {
      const ack: Record<number, number> = {};
      for (const [id, s] of this.slots) ack[id] = s.lastSeq;
      this.broadcast({ t: "snapshot", tick: this.tick, ack, ps: this.snapshots() });
    }
  }
}

type WelcomeMsgShape = Extract<ServerMsg, { t: "welcome" }>;

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
