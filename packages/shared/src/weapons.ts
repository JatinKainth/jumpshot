export interface WeaponDef {
  id: string;
  name: string;
  /** Projectile speed, px/s. */
  bulletSpeed: number;
  /** Minimum ticks between shots — semi-auto cadence. */
  cooldownTicks: number;
  /** Rounds per pickup; emptying the mag disarms the holder. */
  ammo: number;
}

export const WEAPONS = {
  pistol: { id: "pistol", name: "PISTOL", bulletSpeed: 520, cooldownTicks: 19, ammo: 8 },
} as const satisfies Record<string, WeaponDef>;

export type WeaponId = keyof typeof WEAPONS;

export const PISTOL = WEAPONS.pistol;
