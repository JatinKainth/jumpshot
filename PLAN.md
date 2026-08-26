# jumpshot — Plan

Pixel platformer duel: Mario-like movement, guns spawn on the map, two players
on the same LAN shoot each other. 1 life per round, first to 2 round wins takes
the match (best of 3).

## Stack

| Piece   | Choice                                              |
| ------- | --------------------------------------------------- |
| Client  | TypeScript + Phaser 3 (arcade physics), Vite        |
| Server  | Node-compatible TS authoritative server (`ws`)      |
| Shared  | `@jumpshot/shared` — types, constants, map data          |
| Tooling | bun workspaces monorepo                             |
| Art     | Pixel Adventure 1 (Pixel Frog) + Kenney audio, both free/CC0 |

## Architecture

```
Chrome (P1) ─┐
             ├─ WebSocket ── Node server (authoritative sim @60Hz)
Chrome (P2) ─┘                  │ lobby + match FSM
                                └ prints LAN IP → P2 enters it to join
```

- Server owns **all** simulation: movement, gravity, bullets, hit detection,
  gun spawns, score. Clients send input bitmasks on change; receive snapshots
  at 60Hz and interpolate ~50ms behind. No rollback needed at LAN latency.
- Never trust client position — all hit detection is server-side.
- Netcode constants live in `@jumpshot/shared` so client/server can't drift:
  `TICK_RATE_HZ`, `SNAPSHOT_RATE_HZ`, `INTERP_DELAY_MS`.

## Decisions made

- Engine: Phaser + TS over Godot (plays in Chrome, shared client/server code,
  no engine learning curve).
- Gun spawns: every 3s while the round runs, from pre-placed spawnpoints,
  capped at ~3 active on the map.
- v1 arsenal: single pistol (spawner/pickup/bullet systems built generic so
  new guns are data-only additions).

## Match flow (server state machine)

`LOBBY → CHAR_SELECT → COUNTDOWN(3s) → PLAYING ⇄ ROUND_END → MATCH_END`

- PLAYING: pistol spawns every 3s at a random free spawnpoint. Overlap to pick
  up, fire with click/space, bullets despawn on wall/player hit.
- 1 life per round. Round ends when one player dies; simultaneous kill = draw,
  replay the round. First to 2 wins.
- ROUND_END: 3s scoreboard overlay → reset positions/guns → COUNTDOWN.

## Screens

Menu → Create lobby / Join lobby → Lobby (ready-up) → Character select →
Level select → Game + HUD (round pips, held weapon).

All screens are data-driven off registries (`LEVELS`, future `CHARACTERS`,
`WEAPONS` in shared), so shipping with 1 of each doesn't block adding more.

## Milestones

- [x] **M0 – local shell**: monorepo scaffold; controllable square on static
      platform map rendered from `shared/maps.ts`; typecheck + build green.
- [x] **M1 – netplay movement**: WS server, fixed-step loop, input/snapshot
      protocol, interpolation; see the other player move and jump.
- [x] **M2 – combat**: gun spawner (3s cadence, cap 3), pickup, bullets,
      kills, round/match FSM, HUD score.
- [x] **M3 – polish**: client-only connection menu (char select deferred),
      Pixel Adventure character art + animations, terrain tiles, Kenney CC0
      sfx, juice (particles/shake/squash-stretch).
- [ ] **M4+ backlog**: more guns/characters/levels, gamepads, mDNS discovery
      (no IP typing), hosted server for internet play.

## Repo layout

```
packages/
├── shared/   # types, constants, level data + parser (client & server)
├── client/   # Phaser scenes (BootScene, GameScene, …)
└── server/   # added in M1
```
