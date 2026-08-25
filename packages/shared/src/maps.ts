import { TILE_SIZE } from "./constants";
import type { Rect, Vec2 } from "./types";

export interface LevelDef {
  id: string;
  name: string;
  rows: string[];
}

// Legend: '.' empty | '#' solid | 'P' player spawn | 'g' gun spawn
const ARENA_ROWS = [
  "................................",
  "................................",
  "................................",
  "................................",
  "........####............####....",
  "................................",
  "................................",
  "..............g..g..............",
  ".............######.............",
  "................................",
  "....g......................g....",
  "...####..................####...",
  "................................",
  "....P........g......g.......P...",
  "################################",
  "################################",
];

export const LEVELS: LevelDef[] = [
  { id: "arena", name: "Arena", rows: ARENA_ROWS },
];

export interface ParsedLevel {
  cols: number;
  rows: number;
  widthPx: number;
  heightPx: number;
  solids: Rect[];
  playerSpawns: Vec2[];
  gunSpawns: Vec2[];
}

export function parseLevel(def: LevelDef): ParsedLevel {
  const rows = def.rows.length;
  const cols = def.rows[0]?.length ?? 0;
  const solids: Rect[] = [];
  const playerSpawns: Vec2[] = [];
  const gunSpawns: Vec2[] = [];

  for (let y = 0; y < rows; y++) {
    let runStart = -1;
    for (let x = 0; x <= cols; x++) {
      const ch = def.rows[y]?.[x] ?? ".";
      const solid = ch === "#";
      if (solid && runStart === -1) {
        runStart = x;
      }
      if (!solid && runStart !== -1) {
        solids.push({
          x: runStart * TILE_SIZE,
          y: y * TILE_SIZE,
          w: (x - runStart) * TILE_SIZE,
          h: TILE_SIZE,
        });
        runStart = -1;
      }
      if (ch === "P") {
        playerSpawns.push({ x: x * TILE_SIZE + TILE_SIZE / 2, y: y * TILE_SIZE + TILE_SIZE / 2 });
      }
      if (ch === "g") {
        gunSpawns.push({ x: x * TILE_SIZE + TILE_SIZE / 2, y: y * TILE_SIZE + TILE_SIZE / 2 });
      }
    }
  }

  return {
    cols,
    rows,
    widthPx: cols * TILE_SIZE,
    heightPx: rows * TILE_SIZE,
    solids,
    playerSpawns,
    gunSpawns,
  };
}
