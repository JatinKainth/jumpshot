import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "@jumpshot/shared";
import { BootScene } from "./scenes/BootScene";
import { GameScene } from "./scenes/GameScene";

const params = new URLSearchParams(window.location.search);
const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  parent: "app",
  backgroundColor: "#1a1c2c",
  pixelArt: true,
  // ?settimeout drives the loop off rAF (rAF is suspended in occluded tabs).
  fps: { forceSetTimeOut: params.has("settimeout") },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, GameScene],
});

declare global {
  interface Window {
    __game: Phaser.Game;
  }
}
window.__game = game;
