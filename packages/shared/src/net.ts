export const INPUT = {
  LEFT: 1 << 0,
  RIGHT: 1 << 1,
  JUMP: 1 << 2,
  FIRE: 1 << 3,
} as const;

export type WireValue = number | string | boolean;

/**
 * Match lifecycle, driven entirely by the server:
 * wait (free roam, <2 players) → count → play ⇄ rend → mend → count …
 */
export type Phase = "wait" | "count" | "play" | "rend" | "mend";

/** C→S: sampled input bitmask + monotonically increasing sequence. */
export interface InputMsg {
  t: "input";
  seq: number;
  bits: number;
}

/** S→C: assigns the client its player id on join. */
export interface WelcomeMsg {
  t: "welcome";
  id: number;
  tick: number;
  ps: PlayerSnapshot[];
}

/**
 * S→C: authoritative world state at `tick`. `ack` is the last input seq the
 * server processed for each player id (used by that player's prediction).
 * `left` counts down ticks remaining in the active phase (absent in wait/play)
 * and `win` is the round/match winner id (-1 for a drawn round).
 */
export interface SnapshotMsg {
  t: "snapshot";
  tick: number;
  ack: Record<number, number>;
  ps: PlayerSnapshot[];
  ph: Phase;
  left?: number;
  win: number;
  pip: Record<number, number>;
  gs: GunSnapshot[];
  bs: BulletSnapshot[];
}

/** [id, x, y, vx, vy, facing(-1|1), onGround, jumpHeld, alive, armed, ammo] */
export type PlayerSnapshot = [
  id: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  facing: -1 | 1,
  onGround: 0 | 1,
  jumpHeld: 0 | 1,
  alive: 0 | 1,
  armed: 0 | 1,
  ammo: number,
];

/** [id, x, y] — gun lying on the ground, waiting for pickup. */
export type GunSnapshot = [id: number, x: number, y: number];

/** [id, x, y, vx, vy] */
export type BulletSnapshot = [id: number, x: number, y: number, vx: number, vy: number];

export type ClientMsg = InputMsg;
export type ServerMsg = WelcomeMsg | SnapshotMsg;

export function encodeMsg(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

export function decodeClientMsg(data: unknown): ClientMsg | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.t !== "input") return null;
  if (typeof m.seq !== "number" || typeof m.bits !== "number") return null;
  return { t: "input", seq: m.seq, bits: m.bits };
}

export function decodeServerMsg(data: unknown): ServerMsg | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.t === "welcome" || m.t === "snapshot") return data as ServerMsg;
  return null;
}
