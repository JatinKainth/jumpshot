import Phaser from "phaser";
import { PLAYER_SIZE, TILE_SIZE } from "@jumpshot/shared";

export interface SheetTex {
  key: string;
  url: string;
  frameW: number;
  frameH: number;
  frames: number;
}

/**
 * Asset contract for M3. Keys here are referenced by playerView.ts and
 * GameScene — change a key and you own updating every consumer.
 *
 * Character sheets are horizontal PNG strips (Pixel Adventure 1, Pixel Frog).
 * `terrain` is a tile sheet; GameScene picks frames by neighbor exposure.
 */
export const TEX = {
  p1Idle: {
    key: "p1-idle",
    url: "sprites/ninja_frog_idle.png",
    frameW: 32,
    frameH: 32,
    frames: 11,
  },
  p1Run: {
    key: "p1-run",
    url: "sprites/ninja_frog_run.png",
    frameW: 32,
    frameH: 32,
    frames: 12,
  },
  p1Jump: {
    key: "p1-jump",
    url: "sprites/ninja_frog_jump.png",
    frameW: 32,
    frameH: 32,
    frames: 1,
  },
  p1Fall: {
    key: "p1-fall",
    url: "sprites/ninja_frog_fall.png",
    frameW: 32,
    frameH: 32,
    frames: 1,
  },
  p1Dead: {
    key: "p1-dead",
    url: "sprites/ninja_frog_hit.png",
    frameW: 32,
    frameH: 32,
    frames: 7,
  },
  p2Idle: {
    key: "p2-idle",
    url: "sprites/pink_man_idle.png",
    frameW: 32,
    frameH: 32,
    frames: 11,
  },
  p2Run: {
    key: "p2-run",
    url: "sprites/pink_man_run.png",
    frameW: 32,
    frameH: 32,
    frames: 12,
  },
  p2Jump: {
    key: "p2-jump",
    url: "sprites/pink_man_jump.png",
    frameW: 32,
    frameH: 32,
    frames: 1,
  },
  p2Fall: {
    key: "p2-fall",
    url: "sprites/pink_man_fall.png",
    frameW: 32,
    frameH: 32,
    frames: 1,
  },
  p2Dead: {
    key: "p2-dead",
    url: "sprites/pink_man_hit.png",
    frameW: 32,
    frameH: 32,
    frames: 7,
  },
  terrain: {
    key: "terrain",
    url: "sprites/terrain.png",
    frameW: 16,
    frameH: 16,
    frames: 242,
  },
} as const satisfies Record<string, SheetTex>;

/** Legacy generated keys still consumed by GameScene until integration. */
export const GEN = {
  tile: "tile",
  player: "player",
  player2: "player2",
  gun: "gun",
  bullet: "bullet",
  flash: "flash",
} as const;

function generatePlaceholders(scene: Phaser.Scene): void {
  if (scene.textures.exists(GEN.tile)) return;
  const g = scene.make.graphics({ x: 0, y: 0 });
  g.fillStyle(0x3a4466, 1);
  g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  g.fillStyle(0x577095, 1);
  g.fillRect(0, 0, TILE_SIZE, 3);
  g.generateTexture(GEN.tile, TILE_SIZE, TILE_SIZE);

  g.clear();
  g.fillStyle(0xe43b44, 1);
  g.fillRect(0, 0, PLAYER_SIZE, PLAYER_SIZE);
  g.fillStyle(0xffffff, 1);
  g.fillRect(2, 2, 3, 3);
  g.generateTexture(GEN.player, PLAYER_SIZE, PLAYER_SIZE);

  g.clear();
  g.fillStyle(0x2ce8f5, 1);
  g.fillRect(0, 0, PLAYER_SIZE, PLAYER_SIZE);
  g.fillStyle(0x1a1c2c, 1);
  g.fillRect(2, 2, 3, 3);
  g.generateTexture(GEN.player2, PLAYER_SIZE, PLAYER_SIZE);

  g.clear();
  g.fillStyle(0xf7b32b, 1);
  g.fillRect(0, 0, 8, 5);
  g.fillStyle(0x1a1c2c, 1);
  g.fillRect(5, 1, 3, 2);
  g.generateTexture(GEN.gun, 8, 5);

  g.clear();
  g.fillStyle(0xffe066, 1);
  g.fillRect(0, 0, 4, 2);
  g.generateTexture(GEN.bullet, 4, 2);

  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillRect(0, 0, 6, 6);
  g.generateTexture(GEN.flash, 6, 6);
  g.destroy();
}

export function loadGameAssets(scene: Phaser.Scene): Promise<void> {
  generatePlaceholders(scene);
  for (const tex of Object.values(TEX)) {
    if (!scene.textures.exists(tex.key)) {
      scene.load.spritesheet(tex.key, tex.url, {
        frameWidth: tex.frameW,
        frameHeight: tex.frameH,
      });
    }
  }
  return new Promise((resolve) => {
    scene.load.once(Phaser.Loader.Events.COMPLETE, resolve);
    scene.load.start();
  });
}
