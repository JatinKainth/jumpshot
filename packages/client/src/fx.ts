import Phaser from "phaser";

const DEPTH = 10;

const FLASH_KEY = "fx-flash";
const SPARK_KEY = "fx-spark";
const RING_KEY = "fx-ring";

/**
 * Combat juice: muzzle flashes, death bursts, spawn/pickup pops, camera shake.
 * Self-contained — generates its own tiny helper textures idempotently.
 * Every effect cleans up its game objects on tween/emitter completion.
 */
export class Fx {
  private scene: Phaser.Scene;
  private shakeActive = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.ensureTextures();
  }

  private ensureTextures(): void {
    const make = (key: string, size: number, draw: (g: Phaser.GameObjects.Graphics) => void) => {
      if (this.scene.textures.exists(key)) return;
      const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
      draw(g);
      g.generateTexture(key, size, size);
      g.destroy();
    };

    // Soft white square for flashes/particles.
    make(FLASH_KEY, 8, (g) => {
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 8, 8);
    });

    // Smaller square for sparks.
    make(SPARK_KEY, 4, (g) => {
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 4, 4);
    });

    // Hollow white circle for shockwave/pickup rings.
    make(RING_KEY, 32, (g) => {
      g.lineStyle(2, 0xffffff, 1);
      g.strokeCircle(16, 16, 14);
    });
  }

  muzzleFlash(x: number, y: number, facing: -1 | 1): void {
    const flash = this.scene.add
      .image(x + facing * 4, y, FLASH_KEY)
      .setDepth(DEPTH)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(1.6, 1.1);
    this.scene.tweens.add({
      targets: flash,
      scaleX: facing * 2.6,
      scaleY: 0.5,
      alpha: 0,
      duration: 90,
      onComplete: () => flash.destroy(),
    });

    this.burst(SPARK_KEY, x, y, 4, {
      speed: { min: 60, max: 140 },
      angle: { min: facing === 1 ? -35 : 145, max: facing === 1 ? 35 : 215 },
      lifespan: 120,
      scale: { start: 1, end: 0 },
      tint: 0xffe08a,
    });
  }

  deathBurst(x: number, y: number, tint: number): void {
    this.burst(SPARK_KEY, x, y, 18, {
      speed: { min: 70, max: 190 },
      lifespan: 400,
      scale: { start: 1.4, end: 0 },
      alpha: { start: 1, end: 0 },
      gravityY: 260,
      tint,
    });
    this.ring(x, y, tint, 0.4, 3.2, 220);
  }

  spawnPop(x: number, y: number): void {
    this.burst(SPARK_KEY, x, y, 6, {
      speed: { min: 20, max: 60 },
      angle: { min: 200, max: 340 },
      lifespan: 250,
      scale: { start: 1, end: 0 },
      gravityY: -80,
      tint: 0xa8e6ff,
    });
    this.ring(x, y, 0xa8e6ff, 0.3, 1.6, 250);
  }

  pickupPulse(x: number, y: number): void {
    this.burst(SPARK_KEY, x, y, 8, {
      speed: { min: 50, max: 110 },
      lifespan: 200,
      scale: { start: 1, end: 0 },
      tint: 0xfff3b0,
    });
    this.ring(x, y, 0xfff3b0, 0.15, 2, 200);
  }

  shake(intensity = 0.004, durMs = 150): void {
    const cam = this.scene.cameras.main;
    // Reset instead of stacking concurrent shakes.
    if (this.shakeActive) cam.shake(0, 0);
    this.shakeActive = true;
    cam.shake(durMs, intensity, true);
    cam.once(Phaser.Cameras.Scene2D.Events.SHAKE_COMPLETE, () => {
      this.shakeActive = false;
    });
  }

  private burst(
    texture: string,
    x: number,
    y: number,
    count: number,
    config: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig,
  ): void {
    const emitter = this.scene.add.particles(x, y, texture, {
      emitting: false,
      ...config,
    });
    emitter.setDepth(DEPTH);
    emitter.explode(count);
    const life = config.lifespan;
    const ms = typeof life === "number" ? life : ((life as { max?: number }).max ?? 300);
    this.scene.time.delayedCall(ms + 50, () => emitter.destroy());
  }

  private ring(
    x: number,
    y: number,
    tint: number,
    fromScale: number,
    toScale: number,
    durMs: number,
  ): void {
    const img = this.scene.add
      .image(x, y, RING_KEY)
      .setDepth(DEPTH)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(tint)
      .setScale(fromScale);
    this.scene.tweens.add({
      targets: img,
      scale: toScale,
      alpha: 0,
      duration: durMs,
      onComplete: () => img.destroy(),
    });
  }
}
