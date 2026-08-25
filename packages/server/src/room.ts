import {
  BULLET_HALF,
  BULLET_SUBSTEP_PX,
  COUNTDOWN_TICKS,
  GUN_SPAWN_EVERY_TICKS,
  INPUT,
  INPUT_IDLE_TIMEOUT_MS,
  LEVELS,
  MATCH_END_TICKS,
  MAX_GUNS_IN_PLAY,
  MAX_PLAYERS,
  MUZZLE_OFFSET_PX,
  parseLevel,
  PISTOL,
  PICKUP_RADIUS_PX,
  PLAYER_SIZE,
  ROUND_END_TICKS,
  Sim,
  SNAPSHOT_RATE_HZ,
  STEP_DT,
  TICK_RATE_HZ,
  WINS_TO_TAKE_MATCH,
  encodeMsg,
} from "@jumpshot/shared";
import type {
  BulletSnapshot,
  GunSnapshot,
  Phase,
  PlayerSnapshot,
  PlayerState,
  ServerMsg,
  SnapshotMsg,
  WelcomeMsg,
} from "@jumpshot/shared";

const SNAP_EVERY = Math.round(TICK_RATE_HZ / SNAPSHOT_RATE_HZ);
const HALF = PLAYER_SIZE / 2;

interface Slot {
  slot: number;
  state: PlayerState;
  bits: number;
  lastSeq: number;
  lastInputAt: number;
  alive: boolean;
  /** Rounds left in the held weapon; 0 = unarmed (v1: pistol or nothing). */
  ammo: number;
  lastFireTick: number;
}

interface GroundGun {
  id: number;
  x: number;
  y: number;
}

interface Bullet {
  id: number;
  owner: number;
  x: number;
  y: number;
  vx: number;
}

/**
 * Authoritative room state: match/round FSM, gun spawner, pickups, bullets and
 * hit detection all live here; the network layer feeds it inputs and forwards
 * its snapshots.
 */
export class Room {
  private readonly level = parseLevel(LEVELS[0]!);
  private readonly sim = new Sim(this.level);
  private readonly slots = new Map<number, Slot>();
  private readonly freeSlots: number[] = [];
  private broadcast: (msg: ServerMsg) => void = () => {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;
  private tick = 0;

  private phase: Phase = "wait";
  private phaseEndsAt = 0;
  /** Round/match winner id once decided; -1 while undecided or drawn. */
  private winner = -1;
  private pips: Record<number, number> = {};
  private guns: GroundGun[] = [];
  private bullets: Bullet[] = [];
  private nextEntityId = 1;
  private lastSpawnTick = 0;

  get full(): boolean {
    return this.slots.size >= MAX_PLAYERS;
  }

  onBroadcast(fn: (msg: ServerMsg) => void): void {
    this.broadcast = fn;
  }

  join(): { id: number; welcome: WelcomeMsg } {
    const slot = this.freeSlots.pop() ?? this.slots.size;
    const id = slot;
    this.slots.set(id, {
      slot,
      state: this.sim.spawn(slot),
      bits: 0,
      lastSeq: 0,
      lastInputAt: performance.now(),
      alive: true,
      ammo: 0,
      lastFireTick: -Infinity,
    });
    this.pips[id] ??= 0;
    if (this.slots.size >= MAX_PLAYERS) this.beginMatch();
    if (this.timer === null) this.start();
    return { id, welcome: this.welcome(id) };
  }

  leave(id: number): void {
    const s = this.slots.get(id);
    if (!s) return;
    this.slots.delete(id);
    this.freeSlots.push(s.slot);
    this.freeSlots.sort((a, b) => b - a);
    // Abort any structured match — the remaining player falls back to free
    // roam with clean state until the room refills.
    if (this.phase !== "wait") {
      this.phase = "wait";
      this.guns = [];
      this.bullets = [];
      this.pips = {};
      for (const s of this.slots.values()) {
        s.alive = true;
        s.ammo = 0;
      }
    }
  }

  setInput(id: number, seq: number, bits: number): void {
    const s = this.slots.get(id);
    if (!s) return;
    s.bits = bits;
    s.lastSeq = seq;
    s.lastInputAt = performance.now();
  }

  private welcome(selfId: number): WelcomeMsg {
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
        s.alive ? 1 : 0,
        s.ammo > 0 ? 1 : 0,
        s.ammo,
      ]);
    }
    return ps;
  }

  private snapshot(): SnapshotMsg {
    const ack: Record<number, number> = {};
    for (const [id, s] of this.slots) ack[id] = s.lastSeq;
    const gs: GunSnapshot[] = this.guns.map((g) => [g.id, g.x, g.y]);
    const bs: BulletSnapshot[] = this.bullets.map((b) => [
      b.id,
      round(b.x),
      round(b.y),
      round(b.vx),
      0,
    ]);
    return {
      t: "snapshot",
      tick: this.tick,
      ack,
      ps: this.snapshots(),
      ph: this.phase,
      left:
        this.phase === "count" || this.phase === "rend" || this.phase === "mend"
          ? Math.max(0, this.phaseEndsAt - this.tick)
          : undefined,
      win: this.winner,
      pip: { ...this.pips },
      gs,
      bs,
    };
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
    }
    if (this.phase !== "wait" && this.tick >= this.phaseEndsAt) this.advancePhase();

    const playing = this.phase === "play";
    const moving = playing || this.phase === "wait";
    for (const [id, s] of this.slots) {
      if (!s.alive) continue;
      if (playing) this.tryFire(id, s);
      // Free roam while waiting; countdown/scoreboard phases freeze everyone
      // in place (physics still settles them onto the floor).
      this.sim.step(s.state, moving ? s.bits : 0);
    }
    if (playing) {
      this.runSpawner();
      this.runPickups();
      this.stepBullets();
    }

    this.tick++;
    if (this.tick % SNAP_EVERY === 0) this.broadcast(this.snapshot());
  }

  private advancePhase(): void {
    if (this.phase === "count") this.enterPhase("play");
    else if (this.phase === "rend") {
      this.resetRound();
      this.enterPhase("count");
    } else if (this.phase === "mend") this.beginMatch();
  }

  private beginMatch(): void {
    this.pips = {};
    for (const id of this.slots.keys()) this.pips[id] = 0;
    this.resetRound();
    this.enterPhase("count");
  }

  private resetRound(): void {
    for (const s of this.slots.values()) {
      s.state = this.sim.spawn(s.slot);
      s.alive = true;
      s.ammo = 0;
      s.lastFireTick = -Infinity;
    }
    this.guns = [];
    this.bullets = [];
    this.winner = -1;
  }

  private enterPhase(p: Phase): void {
    this.phase = p;
    const dur =
      p === "count"
        ? COUNTDOWN_TICKS
        : p === "rend"
          ? ROUND_END_TICKS
          : p === "mend"
            ? MATCH_END_TICKS
            : 0;
    this.phaseEndsAt = this.tick + dur;
    if (p === "play") this.lastSpawnTick = this.tick;
  }

  private tryFire(id: number, s: Slot): void {
    if (!(s.bits & INPUT.FIRE) || s.ammo <= 0) return;
    if (this.tick - s.lastFireTick < PISTOL.cooldownTicks) return;
    s.lastFireTick = this.tick;
    s.ammo -= 1;
    this.bullets.push({
      id: this.nextEntityId++,
      owner: id,
      x: s.state.x + s.state.facing * MUZZLE_OFFSET_PX,
      y: s.state.y,
      vx: s.state.facing * PISTOL.bulletSpeed,
    });
  }

  private runSpawner(): void {
    if (this.tick - this.lastSpawnTick < GUN_SPAWN_EVERY_TICKS) return;
    if (this.totalGuns() >= MAX_GUNS_IN_PLAY) return;
    const taken = new Set(this.guns.map((g) => `${g.x},${g.y}`));
    const free = this.level.gunSpawns.filter((p) => !taken.has(`${p.x},${p.y}`));
    if (free.length === 0) return;
    const spot = free[Math.floor(Math.random() * free.length)]!;
    this.guns.push({ id: this.nextEntityId++, x: spot.x, y: spot.y });
    this.lastSpawnTick = this.tick;
  }

  private totalGuns(): number {
    let held = 0;
    for (const s of this.slots.values()) if (s.ammo > 0) held++;
    return this.guns.length + held;
  }

  private runPickups(): void {
    for (const s of this.slots.values()) {
      if (!s.alive || s.ammo > 0) continue;
      const gi = this.guns.findIndex(
        (g) => Math.hypot(g.x - s.state.x, g.y - s.state.y) < PICKUP_RADIUS_PX,
      );
      if (gi === -1) continue;
      this.guns.splice(gi, 1);
      s.ammo = PISTOL.ammo;
    }
  }

  private stepBullets(): void {
    const survivors: Bullet[] = [];
    const killed = new Set<number>();
    for (const b of this.bullets) {
      const travel = Math.abs(b.vx) * STEP_DT;
      const steps = Math.max(1, Math.ceil(travel / BULLET_SUBSTEP_PX));
      const dx = (b.vx * STEP_DT) / steps;
      let dead = false;
      for (let i = 0; i < steps && !dead; i++) {
        b.x += dx;
        if (b.x < -BULLET_HALF || b.x > this.sim.widthPx + BULLET_HALF) {
          dead = true;
          break;
        }

        for (const sol of this.sim.solids) {
          if (
            b.x + BULLET_HALF > sol.x &&
            b.x - BULLET_HALF < sol.x + sol.w &&
            b.y + BULLET_HALF > sol.y &&
            b.y - BULLET_HALF < sol.y + sol.h
          ) {
            dead = true;
            break;
          }
        }
        if (dead) break;

        for (const [pid, s] of this.slots) {
          if (pid === b.owner || !s.alive) continue;
          if (
            Math.abs(b.x - s.state.x) < HALF + BULLET_HALF &&
            Math.abs(b.y - s.state.y) < HALF + BULLET_HALF
          ) {
            dead = true;
            killed.add(pid);
            break;
          }
        }
      }
      if (!dead) survivors.push(b);
    }
    this.bullets = survivors;
    if (killed.size > 0) this.resolveKills(killed);
  }

  /**
   * Deaths are resolved after the whole bullet batch so same-tick mutual hits
   * count as a draw and replay the round.
   */
  private resolveKills(killed: Set<number>): void {
    for (const id of killed) {
      const s = this.slots.get(id);
      if (!s) continue;
      s.alive = false;
      s.ammo = 0;
    }
    const aliveIds = [...this.slots.entries()]
      .filter(([, s]) => s.alive)
      .map(([id]) => id);
    if (aliveIds.length > 1) return;
    const draw = aliveIds.length === 0;
    const w = draw ? -1 : aliveIds[0]!;
    this.winner = w;
    if (!draw) this.pips[w] = (this.pips[w] ?? 0) + 1;
    if (!draw && this.pips[w]! >= WINS_TO_TAKE_MATCH) this.enterPhase("mend");
    else this.enterPhase("rend");
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
