import Phaser from "phaser";
import { TEX } from "./assets";
import { PLAYER_SIZE } from "@jumpshot/shared";

export const PLAYER_DEPTH = 5;

const RUN_FPS = 12;
const IDLE_FPS = 8;
const DEAD_FPS = 14;
const SQUASH_MS = 120;
/** Movement larger than this between syncs means a respawn/round reset, not motion. */
const TELEPORT_PX = 24;

type State = "Idle" | "Run" | "Jump" | "Fall" | "Dead";
const STATES: readonly State[] = ["Idle", "Run", "Jump", "Fall", "Dead"];

interface AnimSpec {
  frameRate: number;
  repeat: number;
}

// Single-frame anims (jump/fall) still get an entry so callers can key off a
// uniform `${prefix}-${state}` naming scheme.
const ANIM_SPECS: Record<State, AnimSpec> = {
  Idle: { frameRate: IDLE_FPS, repeat: -1 },
  Run: { frameRate: RUN_FPS, repeat: -1 },
  Jump: { frameRate: 1, repeat: 0 },
  Fall: { frameRate: 1, repeat: 0 },
  Dead: { frameRate: DEAD_FPS, repeat: 0 },
};

export function ensurePlayerAnims(scene: Phaser.Scene): void {
  for (const prefix of ["p1", "p2"] as const) {
    for (const state of STATES) {
      const key = `${prefix}-${state.toLowerCase()}`;
      if (scene.anims.exists(key)) continue;
      const tex = TEX[`${prefix}${state}`];
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(tex.key, { start: 0, end: tex.frames - 1 }),
        frameRate: ANIM_SPECS[state].frameRate,
        repeat: ANIM_SPECS[state].repeat,
      });
    }
  }
}

export class PlayerView {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly prefix: "p1" | "p2";
  private wasAlive = true;
  private wasAirborne = false;
  private prevX = -100;
  private prevY = -100;

  constructor(scene: Phaser.Scene, playerId: 0 | 1) {
    this.prefix = playerId === 0 ? "p1" : "p2";
    ensurePlayerAnims(scene);
    // Origin at feet so squash/stretch grows away from the ground contact point.
    this.sprite = scene.add.sprite(-100, -100, TEX[`${this.prefix}Idle`].key);
    this.sprite.setOrigin(0.5, 1);
    this.sprite.setDepth(PLAYER_DEPTH);
  }

  sync(x: number, y: number, facing: -1 | 1, alive: boolean, onGround: boolean, vx: number, vy: number): void {
    const sprite = this.sprite;
    const teleported = Math.hypot(x - this.prevX, y - this.prevY) > TELEPORT_PX;
    this.prevX = x;
    this.prevY = y;
    sprite.setPosition(x, y + PLAYER_SIZE / 2);
    sprite.setFlipX(facing < 0);

    if (!alive) {
      if (this.wasAlive) {
        sprite.setScale(1);
        sprite.play(`${this.prefix}-dead`);
      }
      this.wasAlive = false;
      return;
    }
    this.wasAlive = true;

    const airborne = !onGround;
    if (teleported) {
      sprite.setScale(1);
    } else if (airborne && !this.wasAirborne && vy < 0) {
      this.tweenScale(sprite, 0.9, 1.15);
    } else if (!airborne && this.wasAirborne) {
      this.tweenScale(sprite, 1.25, 0.75);
    }
    this.wasAirborne = airborne;

    const state = airborne ? (vy < 0 ? "-jump" : "-fall") : Math.abs(vx) > 10 ? "-run" : "-idle";
    sprite.play(`${this.prefix}${state}`, true);
  }

  private tweenScale(sprite: Phaser.GameObjects.Sprite, scaleX: number, scaleY: number): void {
    sprite.scene.tweens.killTweensOf(sprite);
    sprite.setScale(scaleX, scaleY);
    sprite.scene.tweens.add({
      targets: sprite,
      scaleX: 1,
      scaleY: 1,
      duration: SQUASH_MS,
      ease: "Quad.easeOut",
    });
  }

  destroy(): void {
    this.sprite.scene.tweens.killTweensOf(this.sprite);
    this.sprite.destroy();
  }
}
