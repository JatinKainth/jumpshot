import Phaser from "phaser";
import {
  GAME_HEIGHT,
  GAME_WIDTH,
  INPUT,
  INTERP_DELAY_MS,
  LEVELS,
  MUZZLE_OFFSET_PX,
  STEP_DT,
  TICK_RATE_HZ,
  TILE_SIZE,
  PLAYER_SIZE,
  WINS_TO_TAKE_MATCH,
  Sim,
  parseLevel,
  PISTOL,
} from "@jumpshot/shared";
import type {
  Phase,
  PlayerSnapshot,
  PlayerState,
  SnapshotMsg,
} from "@jumpshot/shared";
import { Hud } from "../hud";
import { NetClient } from "../net";
import { TEX } from "../assets";
import { Sfx } from "../audio";
import { Fx } from "../fx";
import { PlayerView } from "../playerView";
import { lastConnection } from "./MenuScene";

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
  alive: boolean;
}

interface TrackedEntity {
  x: number;
  y: number;
  vx: number;
  recvAt: number;
}

interface RemotePose {
  x: number;
  y: number;
  facing: -1 | 1;
  vx: number;
  vy: number;
  onGround: boolean;
  starveMs: number;
}

const STEP_MS = STEP_DT * 1000;
const HISTORY_CAP = TICK_RATE_HZ * 3;
// Bump when netcode-relevant client logic changes; shown in the debug HUD so
// a stale page (missed vite reload) is obvious during testing.
const NET_REV = "m3-polish.1";
// Dead-reckon at most this far past the newest snapshot when the interp window
// starves (jitter, GC pauses) instead of freezing the remote sprite on it.
const EXTRAP_MAX_MS = 100;
// Terrain sheet frames (Pixel Adventure 1, 16px tiles in a 22-col grid,
// index = row*22+col). Likely needs a visual tweak after eyeballing in game.
const TERRAIN_COLS = 22;
const TERRAIN_TOP_FRAME = 0 * TERRAIN_COLS + 0;
const TERRAIN_FILL_FRAME = 1 * TERRAIN_COLS + 0;
// Corpse lingers through its hit anim before being hidden.
const DEATH_HIDE_MS = 500;
const PLAYER_TINTS = [0xe43b44, 0x2ce8f5];

export class GameScene extends Phaser.Scene {
  private sim!: Sim;
  private net!: NetClient;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keysWASD!: Record<"W" | "A" | "D", Phaser.Input.Keyboard.Key>;

  private myId: number | null = null;
  private local: PlayerState | null = null;
  private visualOffset = { x: 0, y: 0 };

  private history: InputSample[] = [];
  private nextSeq = 0;
  private stepAcc = 0;
  private lastFrameTime = 0;

  private remotes = new Map<number, Remote>();
  private views = new Map<number, PlayerView>();
  /** Last observed alive flag per id; absent = never seen (no death fx yet). */
  private aliveKnown = new Map<number, boolean>();
  private deathHide = new Map<number, Phaser.Time.TimerEvent>();
  private hud = new Hud();
  private fx!: Fx;
  private sfx!: Sfx;

  // --- M2 combat state (all mirrored off snapshots) ---
  private phase: Phase = "wait";
  private prevPhase: Phase = "wait";
  private phaseLeftTicks = 0;
  private winner = -1;
  private pips: Record<number, number> = {};
  private iAmAlive = true;
  private iAmArmed = false;
  /** Local ammo estimate, decremented per trigger pull, resynced per snapshot. */
  private iAmAmmo = 0;
  private lastPredictFireAt = -Infinity;
  private lastCountSec = -1;
  private gunSprites = new Map<number, Phaser.GameObjects.Image>();
  private bulletSprites = new Map<number, Phaser.GameObjects.Image>();
  private bulletBuf = new Map<number, TrackedEntity>();
  private centerText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private pipText!: Phaser.GameObjects.Text;
  private ammoText!: Phaser.GameObjects.Text;
  private toastText!: Phaser.GameObjects.Text;

  private readonly flood = new URLSearchParams(window.location.search).has("flood");
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
    this.fx = new Fx(this);
    this.sfx = new Sfx(this);

    this.renderTerrain(level);

    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: "ui-monospace, Menlo, monospace",
      color: "#ffffff",
      stroke: "#1a1c2c",
      strokeThickness: 4,
    };
    this.centerText = this.add
      .text(GAME_WIDTH / 2, 110, "", { ...style, fontSize: "24px" })
      .setOrigin(0.5, 0.5)
      .setResolution(2);
    this.statusText = this.add
      .text(GAME_WIDTH / 2, 26, "", { ...style, fontSize: "12px", color: "#94b0c2" })
      .setOrigin(0.5, 0.5)
      .setResolution(2);
    this.pipText = this.add
      .text(GAME_WIDTH / 2, 5, "", { ...style, fontSize: "12px" })
      .setOrigin(0.5, 0)
      .setResolution(2);
    this.ammoText = this.add
      .text(8, GAME_HEIGHT - 18, "", { ...style, fontSize: "12px" })
      .setOrigin(0, 1)
      .setResolution(2);
    this.toastText = this.add
      .text(GAME_WIDTH / 2, 44, "", { ...style, fontSize: "12px" })
      .setOrigin(0.5, 0.5)
      .setResolution(2);

    this.setStatus("connecting…");

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keysWASD = this.input.keyboard!.addKeys("W,A,D") as Record<
      "W" | "A" | "D",
      Phaser.Input.Keyboard.Key
    >;
    this.input.keyboard!.on("keydown-M", () => {
      this.toast(this.sfx.toggleMute() ? "MUTED" : "SOUND ON");
    });

    // Menu-entered connection beats URL params; NetClient falls back itself
    // when the menu hasn't run (e.g. direct GameScene testing).
    const conn = lastConnection();
    this.net = new NetClient({
      flood: this.flood,
      host: conn?.host,
      port: conn?.port,
    });
    this.net.onStatus = (status) => {
      if (status === "open") return;
      this.setStatus(
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
      this.resetAliveTracking();
      const mine = msg.ps.find((p) => p[0] === msg.id);
      if (mine) {
        this.local = snapshotToState(mine);
        this.iAmAlive = mine[8] === 1;
        this.iAmArmed = mine[9] === 1;
        this.iAmAmmo = mine[10];
      }
      for (const p of msg.ps) {
        if (p[0] !== msg.id) this.pushRemoteSample(p[0], p);
      }
      this.trackAlive(msg.id, this.iAmAlive);
      this.setStatus("");
    };
    this.net.onSnapshot = (msg) => this.applySnapshot(msg);
    this.net.connect();

    (window as unknown as { __jumpshot?: GameScene }).__jumpshot = this;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.net.destroy();
      for (const view of this.views.values()) view.destroy();
      this.views.clear();
    });
  }

  /** Grass-top tiles where exposed to air above, dirt fill elsewhere. */
  private renderTerrain(level: ReturnType<typeof parseLevel>): void {
    const solidAt = (px: number, py: number) =>
      level.solids.some(
        (s) => px >= s.x && px < s.x + s.w && py >= s.y && py < s.y + s.h,
      );
    for (const s of level.solids) {
      for (let y = s.y; y < s.y + s.h; y += TILE_SIZE) {
        for (let x = s.x; x < s.x + s.w; x += TILE_SIZE) {
          const exposedTop = !solidAt(x + TILE_SIZE / 2, y - TILE_SIZE / 2);
          this.add
            .image(
              x + TILE_SIZE / 2,
              y + TILE_SIZE / 2,
              TEX.terrain.key,
            )
            .setFrame(exposedTop ? TERRAIN_TOP_FRAME : TERRAIN_FILL_FRAME);
        }
      }
    }
  }

  update(time: number, delta: number): void {
    const bits = this.sampleBits();
    if (bits !== this.prevBits) {
      this.prevBits = bits;
      this.bitsChangedAt = time;
      this.releaseDivPx = 0;
    }
    this.predictFire(bits, time);

    // Pace off the raw rAF timestamp, not Phaser's delta: smoothDelta clamps
    // to 16.67ms when unfocused / in post-focus cooldown, which on 120Hz
    // displays doubles the step rate and desyncs prediction from the server.
    // Free roam in wait, full combat in play; frozen phases drop accumulated
    // time instead of bursting through it on unfreeze (the server isn't
    // stepping us there either).
    const canAct = this.iAmAlive && this.local !== null && (this.phase === "play" || this.phase === "wait");
    if (!canAct) {
      this.stepAcc = 0;
    } else if (this.lastFrameTime > 0) {
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
    while (canAct && this.stepAcc >= STEP_MS) {
      this.stepAcc -= STEP_MS;
      this.predictStep(bits);
    }
    this.decayVisualOffset(delta / 1000);
    this.render(time);
    if (this.debug) this.flushDebug(time, delta);
  }

  /**
   * Mirrors the server's fire gate (held-bit auto-fire behind cooldownTicks):
   * fast clicks inside the cooldown are suppressed here too instead of
   * flashing / burning HUD ammo on shots the server drops, and holding FIRE
   * keeps flashing at the server's cadence.
   */
  private predictFire(bits: number, time: number): void {
    if (!(bits & INPUT.FIRE)) return;
    if (
      !this.iAmArmed ||
      !this.iAmAlive ||
      this.phase !== "play" ||
      !this.local
    ) {
      return;
    }
    if (this.iAmAmmo <= 0) return;
    if (time - this.lastPredictFireAt < PISTOL.cooldownTicks * STEP_MS) return;
    this.lastPredictFireAt = time;
    this.iAmAmmo--;
    this.updateAmmoHud();
    this.fx.muzzleFlash(
      this.local.x + this.local.facing * MUZZLE_OFFSET_PX,
      this.local.y,
      this.local.facing,
    );
    this.sfx.play("fire", { volume: 0.7 });
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
    const jump = this.cursors.up.isDown || this.keysWASD.W.isDown;
    const fire =
      this.cursors.space.isDown || this.input.activePointer?.isDown === true;
    return (
      (left ? INPUT.LEFT : 0) |
      (right ? INPUT.RIGHT : 0) |
      (jump ? INPUT.JUMP : 0) |
      (fire ? INPUT.FIRE : 0)
    );
  }

  private predictStep(bits: number): void {
    if (!this.local || this.myId === null) return;
    const wasGrounded = this.local.onGround;
    const seq = this.nextSeq++;
    this.sim.step(this.local, bits);
    // Jump sfx keys off leaving the ground with the jump bit held — walking
    // off a ledge without the bit stays silent.
    if (wasGrounded && !this.local.onGround && bits & INPUT.JUMP) {
      this.sfx.play("jump", { volume: 0.5 });
    }
    this.history.push({ seq, bits });
    if (this.history.length > HISTORY_CAP) this.history.shift();
    this.net.sendInput(seq, bits);
  }

  private applySnapshot(msg: SnapshotMsg): void {
    const now = performance.now();
    if (this.dbgLastSnapAt > 0) this.dbg.snapGapMs = now - this.dbgLastSnapAt;
    if (this.dbg.snapGapMs > this.dbg.maxSnapGapMs) this.dbg.maxSnapGapMs = this.dbg.snapGapMs;
    this.dbgLastSnapAt = now;

    this.phase = msg.ph;
    this.phaseLeftTicks = msg.left ?? 0;
    this.winner = msg.win;
    this.pips = msg.pip;
    this.syncWorldUi();

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
        this.views.get(id)?.destroy();
        this.views.delete(id);
        this.aliveKnown.delete(id);
        this.deathHide.get(id)?.remove();
        this.deathHide.delete(id);
      }
    }
    this.syncGuns(msg.gs);
    this.syncBullets(msg.bs, now);
  }

  /**
   * Phase/pip/ammo overlays are pure functions of the newest snapshot, so they
   * refresh here rather than in render() — keeps presentation of authoritative
   * state in one place.
   */
  private syncWorldUi(): void {
    this.setStatus(this.phase === "wait" ? "waiting for player 2…" : "");
    this.pipText.setText(this.pipsText());
    switch (this.phase) {
      case "wait":
        this.centerText.setText("");
        break;
      case "count": {
        const secs = Math.ceil(this.phaseLeftTicks / TICK_RATE_HZ);
        this.centerText.setText(String(secs));
        if (secs !== this.lastCountSec) {
          this.lastCountSec = secs;
          this.sfx.play("beep");
        }
        break;
      }
      case "play":
        this.centerText.setText("");
        break;
      case "rend":
        this.centerText.setText(
          this.winner < 0 ? "DRAW" : `PLAYER ${(this.winner ?? 0) + 1} TAKES THE ROUND`,
        );
        break;
      case "mend":
        this.centerText.setText(`PLAYER ${(this.winner ?? 0) + 1} WINS THE MATCH`);
        break;
    }
    if (this.prevPhase !== this.phase) {
      if ((this.phase === "rend" || this.phase === "mend") && this.winner >= 0) {
        this.sfx.play("win");
      }
      this.prevPhase = this.phase;
    }
    this.updateAmmoHud();
  }

  private setStatus(text: string): void {
    this.statusText.setText(text);
  }

  private pipsText(): string {
    const ids = Object.keys(this.pips).map(Number).sort((a, b) => a - b);
    if (ids.length < 2) return "";
    const dots = (n: number) =>
      "●".repeat(Math.min(n, WINS_TO_TAKE_MATCH)) +
      "○".repeat(Math.max(0, WINS_TO_TAKE_MATCH - n));
    return `P1 ${dots(this.pips[ids[0]!] ?? 0)}   ${dots(this.pips[ids[1]!] ?? 0)} P2`;
  }

  private updateAmmoHud(): void {
    this.ammoText.setText(
      this.iAmArmed && this.iAmAlive ? `${PISTOL.name} ${"•".repeat(Math.max(0, this.iAmAmmo))}` : "",
    );
  }

  private toast(msg: string): void {
    this.tweens.killTweensOf(this.toastText);
    this.toastText.setText(msg).setAlpha(1);
    this.tweens.add({
      targets: this.toastText,
      alpha: 0,
      delay: 500,
      duration: 600,
    });
  }

  private syncGuns(gs: SnapshotMsg["gs"]): void {
    const seen = new Set<number>();
    for (const [id, x, y] of gs) {
      seen.add(id);
      let sprite = this.gunSprites.get(id);
      if (!sprite) {
        sprite = this.add.image(x, y, "gun");
        this.gunSprites.set(id, sprite);
        this.fx.spawnPop(x, y);
      }
      sprite.setPosition(x, y);
    }
    for (const id of [...this.gunSprites.keys()]) {
      if (!seen.has(id)) {
        this.gunSprites.get(id)!.destroy();
        this.gunSprites.delete(id);
      }
    }
  }

  private syncBullets(bs: SnapshotMsg["bs"], now: number): void {
    const seen = new Set<number>();
    for (const [id, x, y, vx] of bs) {
      seen.add(id);
      this.bulletBuf.set(id, { x, y, vx, recvAt: now });
      if (!this.bulletSprites.has(id)) {
        this.bulletSprites.set(id, this.add.image(x, y, "bullet"));
      }
    }
    for (const id of [...this.bulletSprites.keys()]) {
      if (!seen.has(id)) {
        this.bulletSprites.get(id)!.destroy();
        this.bulletSprites.delete(id);
        this.bulletBuf.delete(id);
      }
    }
  }

  private reconcile(snap: PlayerSnapshot, ackedSeq: number): void {
    this.iAmAlive = snap[8] === 1;
    const wasArmed = this.iAmArmed;
    this.iAmArmed = snap[9] === 1;
    this.iAmAmmo = snap[10];
    if (!wasArmed && this.iAmArmed && this.local) {
      this.fx.pickupPulse(this.local.x, this.local.y);
      this.sfx.play("pickup");
    }
    this.trackAlive(snap[0], this.iAmAlive);
    if (!this.local) {
      this.local = snapshotToState(snap);
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
    this.updateAmmoHud();
  }

  /**
   * Death/respawn presentation keyed off alive-flag transitions. Players seen
   * for the first time (welcome/reconnect) never burst — only an observed
   * true→false flip counts as a kill worth presenting.
   */
  private trackAlive(id: number, alive: boolean): void {
    const prev = this.aliveKnown.get(id);
    this.aliveKnown.set(id, alive);
    const view = this.ensureView(id);
    if (!alive) {
      if (prev === true) {
        // Burst at the hitbox center; the view anchors its sprite at the feet.
        const x = view.sprite.x;
        const y = view.sprite.y - PLAYER_SIZE / 2;
        this.fx.deathBurst(x, y, PLAYER_TINTS[id] ?? 0xffffff);
        this.sfx.play("death");
        if (id === this.myId) this.fx.shake();
        this.deathHide.get(id)?.remove();
        this.deathHide.set(
          id,
          this.time.delayedCall(DEATH_HIDE_MS, () => view.sprite.setVisible(false)),
        );
      } else if (prev === undefined) {
        // Arrived already-dead (reconnect mid-round): no kill to present.
        view.sprite.setVisible(false);
      }
      return;
    }
    if (prev === false) {
      this.deathHide.get(id)?.remove();
      this.deathHide.delete(id);
      view.sprite.setVisible(true);
    }
  }

  /** Reconnect resets everyone: fresh welcome snapshots must count as first sight. */
  private resetAliveTracking(): void {
    this.aliveKnown.clear();
    for (const t of this.deathHide.values()) t.remove();
    this.deathHide.clear();
    for (const view of this.views.values()) view.sprite.setVisible(true);
  }

  private pushRemoteSample(id: number, snap: PlayerSnapshot): void {
    let remote = this.remotes.get(id);
    if (!remote) {
      remote = { buffer: [], alive: true };
      this.remotes.set(id, remote);
    }
    remote.alive = snap[8] === 1;
    this.trackAlive(id, remote.alive);
    remote.buffer.push({ recvAt: performance.now(), snap });
    if (remote.buffer.length > 30) remote.buffer.shift();
  }

  private ensureView(id: number): PlayerView {
    let view = this.views.get(id);
    if (!view) {
      view = new PlayerView(this, id === 0 ? 0 : 1);
      this.views.set(id, view);
    }
    return view;
  }

  private decayVisualOffset(dtSec: number): void {
    const k = Math.exp(-dtSec / 0.05);
    this.visualOffset.x *= k;
    this.visualOffset.y *= k;
    if (Math.abs(this.visualOffset.x) < 0.25) this.visualOffset.x = 0;
    if (Math.abs(this.visualOffset.y) < 0.25) this.visualOffset.y = 0;
  }

  private render(time: number): void {
    if (this.local && this.myId !== null) {
      this.ensureView(this.myId).sync(
        this.local.x + this.visualOffset.x,
        this.local.y + this.visualOffset.y,
        this.local.facing,
        this.iAmAlive,
        this.local.onGround,
        this.local.vx,
        this.local.vy,
      );
    }
    const renderAt = performance.now() - INTERP_DELAY_MS;
    for (const [id, remote] of this.remotes) {
      const pose = interpolate(remote.buffer, renderAt);
      if (pose.starveMs > 0) {
        this.dbg.starveMs = pose.starveMs;
        this.dbg.starves++;
        if (pose.starveMs > this.dbg.maxStarveMs) this.dbg.maxStarveMs = pose.starveMs;
      } else {
        this.dbg.starveMs = 0;
      }
      this.ensureView(id).sync(
        pose.x,
        pose.y,
        pose.facing,
        remote.alive,
        pose.onGround,
        pose.vx,
        pose.vy,
      );
    }
    for (const [id, b] of this.bulletBuf) {
      const sprite = this.bulletSprites.get(id);
      if (!sprite) continue;
      // Bullets fly straight — extrapolating beats interpolating here.
      const dtMs = Math.min(time - b.recvAt, EXTRAP_MAX_MS);
      sprite.setPosition(b.x + (b.vx * dtMs) / 1000, b.y);
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

function interpolate(buffer: RemoteSample[], renderAt: number): RemotePose {
  const last = buffer[buffer.length - 1];
  if (!last) {
    return { x: -100, y: -100, facing: 1, vx: 0, vy: 0, onGround: true, starveMs: 0 };
  }
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
      vx: s[3],
      vy: s[4],
      onGround: s[6] === 1,
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
        vx: b.snap[3],
        vy: b.snap[4],
        onGround: b.snap[6] === 1,
        starveMs: 0,
      };
    }
  }
  const first = buffer[0]!;
  return {
    x: first.snap[1],
    y: first.snap[2],
    facing: first.snap[5],
    vx: first.snap[3],
    vy: first.snap[4],
    onGround: first.snap[6] === 1,
    starveMs: 0,
  };
}
