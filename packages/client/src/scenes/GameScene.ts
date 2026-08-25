import Phaser from "phaser";
import {
  INPUT,
  INTERP_DELAY_MS,
  LEVELS,
  STEP_DT,
  TICK_RATE_HZ,
  TILE_SIZE,
  Sim,
  parseLevel,
} from "@jumpshot/shared";
import type { PlayerSnapshot, PlayerState, SnapshotMsg } from "@jumpshot/shared";
import { Hud } from "../hud";
import { NetClient } from "../net";

interface InputSample {
  seq: number;
  bits: number;
}

interface RemoteSample {
  recvAt: number;
  snap: PlayerSnapshot;
}

interface Remote {
  buffer: RemoteSample[];
}

const STEP_MS = STEP_DT * 1000;
const HISTORY_CAP = TICK_RATE_HZ * 3;
// Bump when netcode-relevant client logic changes; shown in the debug HUD so
// a stale page (missed vite reload) is obvious during testing.
const NET_REV = "active-flood";
// Dead-reckon at most this far past the newest snapshot when the interp window
// starves (jitter, GC pauses) instead of freezing the remote sprite on it.
const EXTRAP_MAX_MS = 100;

export class GameScene extends Phaser.Scene {
  private sim!: Sim;
  private net = new NetClient({
    flood: new URLSearchParams(window.location.search).has("flood"),
  });
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keysWASD!: Record<"W" | "A" | "D", Phaser.Input.Keyboard.Key>;

  private myId: number | null = null;
  private local: PlayerState | null = null;
  private localSprite: Phaser.GameObjects.Image | null = null;
  private visualOffset = { x: 0, y: 0 };

  private history: InputSample[] = [];
  private nextSeq = 0;
  private stepAcc = 0;
  private lastFrameTime = 0;

  private remotes = new Map<number, Remote>();
  private sprites = new Map<number, Phaser.GameObjects.Image>();
  private hud = new Hud();

  private readonly debug = new URLSearchParams(window.location.search).has("debug");
  private readonly traceEnabled = new URLSearchParams(window.location.search).has("trace");
  private dbg = {
    ackLag: 0,
    divPx: 0,
    maxDivPx: 0,
    snapGapMs: 0,
    maxSnapGapMs: 0,
    starveMs: 0,
    maxStarveMs: 0,
    starves: 0,
  };
  private dbgLastSnapAt = 0;
  private dbgFlushAt = 0;
  // Divergence measured right after a key press/release — quantifies the
  // "snap on leave a key" feel separately from steady-state drift.
  private prevBits = -1;
  private bitsChangedAt = -Infinity;
  private releaseDivPx = 0;
  private maxReleaseDivPx = 0;
  // Rolling net trace + last big divergence spike (frozen on HUD for reading
  // after the fact). ?trace=1 logs every reconcile; spikes always captured.
  private netTrace: string[] = [];
  private spike: string | null = null;
  private spikeAt = 0;

  constructor() {
    super("GameScene");
  }

  create(): void {
    const level = parseLevel(LEVELS[0]!);
    this.sim = new Sim(level);
    this.cameras.main.setBounds(0, 0, level.widthPx, level.heightPx);

    for (const s of level.solids) {
      for (let x = s.x; x < s.x + s.w; x += TILE_SIZE) {
        this.add.image(x + 8, s.y + 8, "tile");
      }
    }

    this.hud.set("connecting…");

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keysWASD = this.input.keyboard!.addKeys("W,A,D") as Record<
      "W" | "A" | "D",
      Phaser.Input.Keyboard.Key
    >;

    this.net.onStatus = (status) => {
      if (status === "open") return;
      this.hud.set(
        status === "connecting"
          ? "connecting…"
          : status === "full"
            ? "room full (2 players max)"
            : "disconnected — retrying…",
      );
    };
    this.net.onWelcome = (msg) => {
      this.myId = msg.id;
      // Reconnect (e.g. server restart) must discard inputs predicted against
      // the old session: the fresh server acks low seqs, and replaying stale
      // history onto the new spawn state rubber-bands the self-view.
      this.history.length = 0;
      this.visualOffset.x = 0;
      this.visualOffset.y = 0;
      const mine = msg.ps.find((p) => p[0] === msg.id);
      if (mine) {
        this.local = snapshotToState(mine);
        this.localSprite = this.ensureSprite(msg.id);
      }
      for (const p of msg.ps) {
        if (p[0] !== msg.id) this.pushRemoteSample(p[0], p);
      }
      this.hud.set("");
    };
    this.net.onSnapshot = (msg) => this.applySnapshot(msg);
    this.net.connect();

    (window as unknown as { __jumpshot?: GameScene }).__jumpshot = this;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.net.destroy());
  }

  update(time: number, delta: number): void {
    const bits = this.sampleBits();
    if (bits !== this.prevBits) {
      this.prevBits = bits;
      this.bitsChangedAt = time;
      this.releaseDivPx = 0;
    }

    // Pace off the raw rAF timestamp, not Phaser's delta: smoothDelta clamps
    // to 16.67ms when unfocused / in post-focus cooldown, which on 120Hz
    // displays doubles the step rate and desyncs prediction from the server.
    if (this.lastFrameTime > 0) {
      const frameGap = time - this.lastFrameTime;
      if (frameGap > 500) {
        // Occluded tabs get no rAF at all while the server (holding the last
        // bits) keeps moving the player. Don't replay stale inputs against a
        // world that moved on — drop them and resync off the next snapshot.
        this.stepAcc = 0;
        this.history.length = 0;
      } else {
        this.stepAcc += frameGap;
      }
    }
    this.lastFrameTime = time;
    while (this.stepAcc >= STEP_MS) {
      this.stepAcc -= STEP_MS;
      this.predictStep(bits);
    }
    this.decayVisualOffset(delta / 1000);
    this.render();
    if (this.debug) this.flushDebug(time, delta);
  }

  private flushDebug(time: number, delta: number): void {
    if (time < this.dbgFlushAt) return;
    this.dbgFlushAt = time + 250;
    const d = this.dbg;
    this.hud.debug(
      `net ${NET_REV}  fps ${Math.round(1000 / Math.max(delta, 1))}  seq ${this.nextSeq}  ackLag ${d.ackLag}  hist ${this.history.length}\n` +
        `div ${d.divPx.toFixed(1)}px (max ${d.maxDivPx.toFixed(1)})  relDiv ${this.releaseDivPx.toFixed(1)} (max ${this.maxReleaseDivPx.toFixed(1)})\n` +
        `vo (${this.visualOffset.x.toFixed(1)},${this.visualOffset.y.toFixed(1)})  snapGap ${d.snapGapMs.toFixed(1)}ms (max ${d.maxSnapGapMs.toFixed(0)})\n` +
        `starve ${d.starveMs.toFixed(0)}ms (max ${d.maxStarveMs.toFixed(0)} ×${d.starves})\n` +
        (this.spike ? `${this.spike}\nlast: ${this.netTrace.slice(-3).join(" | ")}` : "no spikes"),
    );
  }

  private sampleBits(): number {
    const left = this.cursors.left.isDown || this.keysWASD.A.isDown;
    const right = this.cursors.right.isDown || this.keysWASD.D.isDown;
    const jump =
      this.cursors.up.isDown || this.keysWASD.W.isDown || this.cursors.space.isDown;
    return (left ? INPUT.LEFT : 0) | (right ? INPUT.RIGHT : 0) | (jump ? INPUT.JUMP : 0);
  }

  private predictStep(bits: number): void {
    if (!this.local || this.myId === null) return;
    const seq = this.nextSeq++;
    this.sim.step(this.local, bits);
    this.history.push({ seq, bits });
    if (this.history.length > HISTORY_CAP) this.history.shift();
    this.net.sendInput(seq, bits);
  }

  private applySnapshot(msg: SnapshotMsg): void {
    const now = performance.now();
    if (this.dbgLastSnapAt > 0) this.dbg.snapGapMs = now - this.dbgLastSnapAt;
    if (this.dbg.snapGapMs > this.dbg.maxSnapGapMs) this.dbg.maxSnapGapMs = this.dbg.snapGapMs;
    this.dbgLastSnapAt = now;
    const seen = new Set<number>();
    for (const p of msg.ps) {
      seen.add(p[0]);
      if (this.myId !== null && p[0] === this.myId) {
        this.dbg.ackLag = this.nextSeq - (msg.ack[this.myId] ?? 0);
        this.reconcile(p, msg.ack[this.myId] ?? 0);
      } else {
        this.pushRemoteSample(p[0], p);
      }
    }
    for (const id of [...this.remotes.keys()]) {
      if (!seen.has(id)) {
        this.remotes.delete(id);
        this.sprites.get(id)?.destroy();
        this.sprites.delete(id);
      }
    }
  }

  private reconcile(snap: PlayerSnapshot, ackedSeq: number): void {
    if (!this.local) {
      this.local = snapshotToState(snap);
      this.localSprite ??= this.ensureSprite(snap[0]);
      return;
    }
    const corrected = snapshotToState(snap);
    const preDiv = this.local
      ? Math.hypot(this.local.x - corrected.x, this.local.y - corrected.y)
      : 0;
    this.dbg.divPx = preDiv;
    if (preDiv > this.dbg.maxDivPx) this.dbg.maxDivPx = preDiv;
    const justChanged = performance.now() - this.bitsChangedAt < 300;
    if (justChanged) {
      this.releaseDivPx = Math.max(this.releaseDivPx, preDiv);
      if (this.releaseDivPx > this.maxReleaseDivPx)
        this.maxReleaseDivPx = this.releaseDivPx;
    }
    if (this.traceEnabled || preDiv > 1) {
      this.netTrace.push(
        `#${this.nextSeq} ack=${ackedSeq} h=${this.history.length}${justChanged ? "!" : ""} div=${preDiv.toFixed(1)} x=${Math.round(this.local.x)} y=${Math.round(this.local.y)}${preDiv > 8 ? " <<<SPIKE" : ""}`,
      );
      if (this.netTrace.length > 40) this.netTrace.shift();
    }
    if (preDiv > 8 && performance.now() - this.spikeAt > 500) {
      this.spikeAt = performance.now();
      this.spike =
        `SPIKE ${preDiv.toFixed(1)}px @#${this.nextSeq} ack=${ackedSeq} h=${this.history.length} snapGap=${this.dbg.snapGapMs.toFixed(0)}ms`;
      console.warn("[jumpshot]", this.spike, "\n" + this.netTrace.join("\n"));
    }
    this.history = this.history.filter((h) => h.seq > ackedSeq);
    for (const h of this.history) this.sim.step(corrected, h.bits);

    this.visualOffset.x += this.local.x - corrected.x;
    this.visualOffset.y += this.local.y - corrected.y;
    this.local = corrected;
  }

  private pushRemoteSample(id: number, snap: PlayerSnapshot): void {
    let remote = this.remotes.get(id);
    if (!remote) {
      remote = { buffer: [] };
      this.remotes.set(id, remote);
    }
    remote.buffer.push({ recvAt: performance.now(), snap });
    if (remote.buffer.length > 30) remote.buffer.shift();
    this.ensureSprite(id);
  }

  private ensureSprite(id: number): Phaser.GameObjects.Image {
    let sprite = this.sprites.get(id);
    if (!sprite) {
      sprite = this.add.image(-100, -100, id === 0 ? "player" : "player2");
      this.sprites.set(id, sprite);
    }
    return sprite;
  }

  private decayVisualOffset(dtSec: number): void {
    const k = Math.exp(-dtSec / 0.05);
    this.visualOffset.x *= k;
    this.visualOffset.y *= k;
    if (Math.abs(this.visualOffset.x) < 0.25) this.visualOffset.x = 0;
    if (Math.abs(this.visualOffset.y) < 0.25) this.visualOffset.y = 0;
  }

  private render(): void {
    if (this.local && this.localSprite) {
      this.localSprite.setPosition(
        this.local.x + this.visualOffset.x,
        this.local.y + this.visualOffset.y,
      );
      this.localSprite.setFlipX(this.local.facing < 0);
    }
    const renderAt = performance.now() - INTERP_DELAY_MS;
    for (const [id, remote] of this.remotes) {
      const sprite = this.sprites.get(id)!;
      const pos = interpolate(remote.buffer, renderAt);
      if (pos.starveMs > 0) {
        this.dbg.starveMs = pos.starveMs;
        this.dbg.starves++;
        if (pos.starveMs > this.dbg.maxStarveMs) this.dbg.maxStarveMs = pos.starveMs;
      } else {
        this.dbg.starveMs = 0;
      }
      sprite.setPosition(pos.x, pos.y);
      sprite.setFlipX(pos.facing < 0);
    }
  }
}

function snapshotToState(p: PlayerSnapshot): PlayerState {
  return {
    x: p[1],
    y: p[2],
    vx: p[3],
    vy: p[4],
    facing: p[5],
    onGround: p[6] === 1,
    jumpHeldPrev: p[7] === 1,
  };
}

function interpolate(
  buffer: RemoteSample[],
  renderAt: number,
): { x: number; y: number; facing: -1 | 1; starveMs: number } {
  const last = buffer[buffer.length - 1];
  if (!last) return { x: -100, y: -100, facing: 1, starveMs: 0 };
  if (buffer.length < 2 || renderAt >= last.recvAt) {
    // Past the newest sample: project briefly on its velocity rather than
    // freeze on it, so jitter can't stall the remote sprite.
    const dtMs =
      buffer.length < 2 ? 0 : Math.min(renderAt - last.recvAt, EXTRAP_MAX_MS);
    const s = last.snap;
    return {
      x: s[1] + s[3] * (dtMs / 1000),
      y: s[2] + s[4] * (dtMs / 1000),
      facing: s[5],
      starveMs: dtMs,
    };
  }
  for (let i = buffer.length - 2; i >= 0; i--) {
    const a = buffer[i]!;
    const b = buffer[i + 1]!;
    if (renderAt >= a.recvAt) {
      const t = (renderAt - a.recvAt) / (b.recvAt - a.recvAt);
      return {
        x: a.snap[1] + (b.snap[1] - a.snap[1]) * t,
        y: a.snap[2] + (b.snap[2] - a.snap[2]) * t,
        facing: b.snap[5],
        starveMs: 0,
      };
    }
  }
  const first = buffer[0]!;
  return { x: first.snap[1], y: first.snap[2], facing: first.snap[5], starveMs: 0 };
}
