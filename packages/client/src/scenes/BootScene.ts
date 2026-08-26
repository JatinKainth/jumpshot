import Phaser from "phaser";
import { loadGameAssets } from "../assets";
import { loadSfxAssets } from "../audio";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  async create(): Promise<void> {
    loadSfxAssets(this);
    await loadGameAssets(this);
    this.scene.start("MenuScene");
  }
}
