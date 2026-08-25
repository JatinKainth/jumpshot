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

// --- Combat / match flow ---
export const COUNTDOWN_TICKS = 3 * TICK_RATE_HZ;
export const ROUND_END_TICKS = 3 * TICK_RATE_HZ;
export const MATCH_END_TICKS = 4 * TICK_RATE_HZ;
export const WINS_TO_TAKE_MATCH = 2;
export const GUN_SPAWN_EVERY_TICKS = 3 * TICK_RATE_HZ;
// Cap counts ground guns AND guns held by players.
export const MAX_GUNS_IN_PLAY = 3;
export const PICKUP_RADIUS_PX = 10;
export const MUZZLE_OFFSET_PX = PLAYER_SIZE / 2 + 2;
export const BULLET_HALF = 2;
// A pistol round covers ~8.7px/tick; substep integration so bullets can't hop
// over a 12px player or clip through tile corners between ticks.
export const BULLET_SUBSTEP_PX = 4;
