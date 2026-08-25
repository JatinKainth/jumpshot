export const TILE_SIZE = 16;
export const GAME_WIDTH = 512;
export const GAME_HEIGHT = 256;

export const GRAVITY = 1400;
export const RUN_SPEED = 180;
export const JUMP_VELOCITY = -460;
export const JUMP_CUT_VELOCITY = -120;
// Keep per-tick fall displacement (< 16px/tick) below tile height so the
// axis-separated AABB step can't tunnel through floors.
export const MAX_FALL_SPEED = 900;
export const PLAYER_SIZE = 12;

export const TICK_RATE_HZ = 60;
export const SNAPSHOT_RATE_HZ = 60;
// ~3 snapshot intervals of jitter headroom; the dominant term in how stale
// a remote player looks. Raise only if links get lossier than LAN.
export const INTERP_DELAY_MS = 50;
export const MAX_PLAYERS = 2;
// A live client sends inputs (real changes or keepalives) at least every
// ~130ms. Beyond this, the client is hidden/crashed — stop simulating its
// held keys so an unfocused player doesn't run into a wall forever.
export const INPUT_IDLE_TIMEOUT_MS = 500;
