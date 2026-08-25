import {
  GRAVITY,
  JUMP_CUT_VELOCITY,
  JUMP_VELOCITY,
  MAX_FALL_SPEED,
  PLAYER_SIZE,
  RUN_SPEED,
  TICK_RATE_HZ,
} from "./constants";
import { INPUT } from "./net";
import type { ParsedLevel } from "./maps";
import type { Vec2 } from "./types";

export const STEP_DT = 1 / TICK_RATE_HZ;

export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: -1 | 1;
  onGround: boolean;
  jumpHeldPrev: boolean;
}

const HALF = PLAYER_SIZE / 2;

function overlaps(
  x: number,
  y: number,
  r: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    x + HALF > r.x && x - HALF < r.x + r.w && y + HALF > r.y && y - HALF < r.y + r.h
  );
}

/**
 * Authoritative fixed-step player physics, shared by the server and the
 * client's prediction so both produce identical motion from the same inputs.
 * Axis-separated AABB resolution against merged level rects.
 */
export class Sim {
  readonly solids: { x: number; y: number; w: number; h: number }[];
  readonly widthPx: number;
  readonly heightPx: number;
  private readonly spawns: Vec2[];

  constructor(level: ParsedLevel) {
    this.solids = level.solids.map((s) => ({ ...s }));
    this.widthPx = level.widthPx;
    this.heightPx = level.heightPx;
    this.spawns = level.playerSpawns;
  }

  spawn(index: number): PlayerState {
    const s = this.spawns[index % this.spawns.length] ?? { x: HALF, y: HALF };
    return {
      x: s.x,
      y: s.y,
      vx: 0,
      vy: 0,
      facing: 1,
      onGround: false,
      jumpHeldPrev: false,
    };
  }

  step(p: PlayerState, bits: number): void {
    const dir = bits & INPUT.RIGHT ? 1 : bits & INPUT.LEFT ? -1 : 0;
    p.vx = dir * RUN_SPEED;
    if (dir !== 0) p.facing = dir as -1 | 1;

    const jumpHeld = (bits & INPUT.JUMP) !== 0;
    if (jumpHeld && !p.jumpHeldPrev && p.onGround) {
      p.vy = JUMP_VELOCITY;
      p.onGround = false;
    }
    if (!jumpHeld && p.vy < JUMP_CUT_VELOCITY) {
      p.vy = JUMP_CUT_VELOCITY;
    }
    p.jumpHeldPrev = jumpHeld;

    p.vy += GRAVITY * STEP_DT;
    if (p.vy > MAX_FALL_SPEED) p.vy = MAX_FALL_SPEED;

    // X axis
    p.x += p.vx * STEP_DT;
    for (const s of this.solids) {
      if (!overlaps(p.x, p.y, s)) continue;
      if (p.vx > 0) {
        p.x = s.x - HALF;
      } else if (p.vx < 0) {
        p.x = s.x + s.w + HALF;
      }
      p.vx = 0;
    }
    if (p.x < HALF) {
      p.x = HALF;
      p.vx = 0;
    } else if (p.x > this.widthPx - HALF) {
      p.x = this.widthPx - HALF;
      p.vx = 0;
    }

    // Y axis
    p.y += p.vy * STEP_DT;
    p.onGround = false;
    for (const s of this.solids) {
      if (!overlaps(p.x, p.y, s)) continue;
      if (p.vy > 0) {
        p.y = s.y - HALF;
        p.onGround = true;
      } else if (p.vy < 0) {
        p.y = s.y + s.h + HALF;
      }
      p.vy = 0;
    }
    if (p.y < HALF) {
      p.y = HALF;
      p.vy = 0;
    } else if (p.y > this.heightPx - HALF) {
      p.y = this.heightPx - HALF;
      p.onGround = true;
      p.vy = 0;
    }
  }
}
