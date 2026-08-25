export const INPUT = {
  LEFT: 1 << 0,
  RIGHT: 1 << 1,
  JUMP: 1 << 2,
} as const;

export type WireValue = number | string | boolean;

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
 */
export interface SnapshotMsg {
  t: "snapshot";
  tick: number;
  ack: Record<number, number>;
  ps: PlayerSnapshot[];
}

/** [id, x, y, vx, vy, facing(-1|1), onGround, jumpHeld] */
export type PlayerSnapshot = [
  id: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  facing: -1 | 1,
  onGround: 0 | 1,
  jumpHeld: 0 | 1,
];

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
