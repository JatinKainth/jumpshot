import Phaser from "phaser";
import { PLAYER_SIZE, TILE_SIZE } from "@jumpshot/shared";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  create(): void {
    if (!this.textures.exists("tile")) {
      const g = this.make.graphics({ x: 0, y: 0 });
      g.fillStyle(0x3a4466, 1);
      g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      g.fillStyle(0x577095, 1);
      g.fillRect(0, 0, TILE_SIZE, 3);
      g.generateTexture("tile", TILE_SIZE, TILE_SIZE);

      g.clear();
      g.fillStyle(0xe43b44, 1);
      g.fillRect(0, 0, PLAYER_SIZE, PLAYER_SIZE);
      g.fillStyle(0xffffff, 1);
      g.fillRect(2, 2, 3, 3);
      g.generateTexture("player", PLAYER_SIZE, PLAYER_SIZE);

      g.clear();
      g.fillStyle(0x2ce8f5, 1);
      g.fillRect(0, 0, PLAYER_SIZE, PLAYER_SIZE);
      g.fillStyle(0x1a1c2c, 1);
      g.fillRect(2, 2, 3, 3);
      g.generateTexture("player2", PLAYER_SIZE, PLAYER_SIZE);
      g.destroy();
    }

    this.scene.start("GameScene");
  }
}
