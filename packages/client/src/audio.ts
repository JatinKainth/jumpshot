import Phaser from "phaser";

export interface SfxDef {
  key: string;
  urls: string[];
}

/** Audio contract for M3 — keys referenced by GameScene via `Sfx.play`. */
export const SFX = {
  fire: { key: "sfx-fire", urls: ["sfx/fire.ogg", "sfx/fire.mp3"] },
  death: { key: "sfx-death", urls: ["sfx/death.ogg", "sfx/death.mp3"] },
  pickup: { key: "sfx-pickup", urls: ["sfx/pickup.ogg", "sfx/pickup.mp3"] },
  beep: { key: "sfx-beep", urls: ["sfx/beep.ogg", "sfx/beep.mp3"] },
  win: { key: "sfx-win", urls: ["sfx/win.ogg", "sfx/win.mp3"] },
  jump: { key: "sfx-jump", urls: ["sfx/jump.ogg", "sfx/jump.mp3"] },
} as const satisfies Record<string, SfxDef>;

export type SfxKey = keyof typeof SFX;

export function loadSfxAssets(scene: Phaser.Scene): void {
  for (const def of Object.values(SFX)) {
    if (!scene.sound.get(def.key)) scene.load.audio(def.key, def.urls);
  }
}

/** Min interval between plays of the same key; countdown beeps and held fire can fire rapidly. */
const MIN_PLAY_INTERVAL_MS = 60;

export class Sfx {
  private scene: Phaser.Scene;
  private muted = false;
  private lastPlayedAt = new Map<SfxKey, number>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  play(key: SfxKey, opts?: { volume?: number; rate?: number }): void {
    if (this.muted) return;
    const now = this.scene.time.now;
    if (now - (this.lastPlayedAt.get(key) ?? -Infinity) < MIN_PLAY_INTERVAL_MS) return;
    this.lastPlayedAt.set(key, now);
    const def = SFX[key];
    this.scene.sound.play(def.key, {
      volume: opts?.volume ?? 1,
      rate: opts?.rate ?? 1,
    });
  }

  /** Returns the new muted state. */
  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }
}
