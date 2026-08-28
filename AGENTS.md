# AGENT.md — jumpshot

> Read this file at the start of every session. It replaces tribal knowledge — you should not need to ask the user for repo state.

## Rule: use `ghp` not `gh`

This is a personal project under `~/code/personal/jumpshot` (`JatinKainth/jumpshot` on GitHub, default branch `main`).

- **Always use `ghp` instead of `gh`** for every GitHub CLI invocation (`ghp pr create`, `ghp pr view`, `ghp auth status`, etc.).
- `ghp` is `gh` with `GH_CONFIG_DIR="$HOME/.config/gh-personal"` (personal account `JatinKainth`). Do not mix `gh` and `ghp` in this repo.
- For scripts/subprocesses that hardcode `gh`, export `GH_CONFIG_DIR="$HOME/.config/gh-personal"` so the inner `gh` picks up the personal config.
- Verify with `ghp auth status` before anything public — expect `JatinKainth`, not a work account.

## What this repo is

Pixel platformer duel — Mario-like movement, guns spawn on the map, 2 players on the same network shoot it out. 1 life per round, best of 3 (first to 2 wins). See `README.md:1` and `PLAN.md:1`.

## Stack

| Piece  | Choice | Location |
|--------|--------|----------|
| Client | TypeScript + Phaser 3 (arcade physics) + Vite | `packages/client/` |
| Server | Node-compatible TS authoritative server (`ws`) | `packages/server/` |
| Shared | `@jumpshot/shared` — types, constants, level data, sim, wire protocol | `packages/shared/` |
| Tooling | bun workspaces monorepo | `package.json:1`, `bun.lock` |
| Art | Pixel Adventure 1 (Pixel Frog) + Kenney CC0 audio | `packages/client/public/` |
| Deploy | Client → GitHub Pages (`.github/workflows/deploy.yml:1`), Server → Fly (`fly.toml:1`, `Dockerfile:1`) | |

## Repo layout

```
packages/
  shared/src/  constants.ts  types.ts  maps.ts  sim.ts  weapons.ts  net.ts  index.ts
  client/src/  main.ts  net.ts  assets.ts  audio.ts  hud.ts  fx.ts  playerView.ts  scenes/{BootScene,MenuScene,GameScene}.ts
  client/      vite.config.ts  index.html  public/
  server/src/  index.ts  room.ts  scripts/smoke.ts
.github/workflows/deploy.yml   fly.toml   Dockerfile   PLAN.md   README.md
```

<!-- Milestones mirror README.md / PLAN.md — update this section on every merge that lands a milestone or notable feature. -->
## Current state

### Milestones

| Milestone | State | Notes |
|-----------|-------|-------|
| M0 local shell | done | Controllable square on static platform map (`packages/shared/src/maps.ts:1`, `packages/shared/src/sim.ts:1`) |
| M1 netplay | done | Authoritative WS server at 60Hz, input bitmasks on change, prediction (self) + interpolation (remote 50ms) |
| M2 combat | done | Pistols spawn every 3s at random free spawnpoints (cap 3), pickup by overlap, fire, substep bullet integration, round/match FSM + HUD pips |
| M3 polish | done | Connection menu, Pixel Adventure sprites + anims (idle/run/jump/fall/dead), tile terrain, Kenney sfx, juice (muzzle flash, death particles, camera shake, squash-and-stretch), `M` mutes |
| M4+ backlog | todo | More guns/characters/levels, gamepads, mDNS discovery, hosted server for internet play (`PLAN.md:71`) |

For detailed milestone history see `README.md:1` and `PLAN.md:1`; for recent changes run `git log origin/main --oneline`.

### Recent work

wss/hosted-server support on `main`: `packages/client/src/net.ts:94` now resolves `ws://` vs `wss://` (supports `?host=wss://…`, `?secure`/`?wss`/`?tls` params, same-host port handling), plus `packages/server/src/index.ts:1` http health endpoints (`/health`, `/healthz`) and `fly.toml:1`/`Dockerfile:1` for Fly deployment, with follow-up review fixes (health slash, LAN log, Dockerfile prune, same-host https wss regression).

## Architecture — read before changing netcode/physics

- **Authoritative server** owns all sim: `packages/server/src/room.ts:70` (`Room`) runs the fixed-step loop at `TICK_RATE_HZ=60` (`packages/shared/src/constants.ts:14`), `SNAPSHOT_RATE_HZ=60`, `INTERP_DELAY_MS=50` (exactly 50ms). Clients send input bitmasks; server broadcasts snapshots.
- **Never trust client position** — hit detection is server-side, bullets use substep integration (`BULLET_SUBSTEP_PX=4` in `packages/shared/src/constants.ts:38`, `packages/server/src/room.ts:330`) to avoid tunneling.
- **Netcode constants live in `@jumpshot/shared`** so client/server cannot drift (`packages/shared/src/constants.ts:1`).
- **Wire protocol** `packages/shared/src/net.ts:1`: `INPUT` bitmask (`LEFT`/`RIGHT`/`JUMP`/`FIRE`), `Phase = "wait"|"count"|"play"|"rend"|"mend"`, `InputMsg`/`WelcomeMsg`/`SnapshotMsg` + `encodeMsg`/`decode*Msg`.
- **Physics** `packages/shared/src/sim.ts:43` (`Sim`): axis-separated AABB, shared by server and client prediction — both must produce identical motion from same inputs.
- **Client net** `packages/client/src/net.ts:7` (`NetClient`): `wsUrl()` resolution, `sendInput()` pacing (flood vs sparse), reconnect. `MenuScene` → `GameScene` handles prediction (self) + interpolation (remote).
- **Match FSM** `packages/server/src/room.ts:82` (`wait → count(3s) → play ⇄ rend(3s) → mend(4s) → count`), 1 life/round, simultaneous kill = draw + replay, first to `WINS_TO_TAKE_MATCH=2` wins (`packages/shared/src/constants.ts:25`). Free roam while `wait`, frozen during `count`/`rend`/`mend` except physics settling.
- **Level** `packages/shared/src/maps.ts:1`: `LEVELS` registry + `parseLevel()`; `GRAVITY=1400`, `RUN_SPEED=180`, `JUMP_VELOCITY=-460` etc. in `packages/shared/src/constants.ts:1`.

## Commands

```sh
bun install                          # install (bun workspaces, bun.lock)
bun run server   # == cd packages/server && bun run src/index.ts  — ws on :8080, prints LAN IP
bun run dev      # == cd packages/client && bun x --bun vite        — client on :5173
bun run typecheck  # tsc --noEmit across shared + server + client
bun run build      # vite build → packages/client/dist
bun run preview    # vite preview
# server smoke: bun run --cwd packages/server smoke  (scripts/smoke.ts)
```

Overrides: `JUMPSHOT_PORT=...` or `PORT=...` for server port; `?host=x.x.x.x&port=8080` (or `?host=wss://…`) query params for client WS target (`packages/client/src/net.ts:94`).

P1 opens `http://localhost:5173`, P2 opens `http://<LAN-IP>:5173` — both connect to `ws://<host>:8080` automatically.
Deployed client: `https://jatinkainth.github.io/jumpshot/` (Pages serves static client only; needs hosted `wss://` server for internet play — `README.md:62`).

## Controls

Move `A`/`D` or `←`/`→`, Jump `Space`/`W`/`↑` (release early = shorter), Fire `Space`/click, Mute `M`.

## Conventions

- Monorepo `bun workspaces` (`packages/*`), `type: module` in each package, `tsconfig.base.json` at root.
- `PLAN.md:1` is the design doc / roadmap; `README.md:1` is the user-facing status + run instructions.
- GitHub Pages deploy on every push to `main` (`.github/workflows/deploy.yml:1` does `bun install → typecheck → build → upload-pages-artifact → deploy-pages`).
- Fly server: `Dockerfile:1` is a multi-stage build — base stage `COPY packages ./packages` + `bun install --frozen-lockfile`, then prod stage copies `shared`+`server`+`client` and prunes `client` (rewrites `package.json` workspaces, `rm -rf packages/client`, reinstall without `phaser`/`vite`) so the Fly image doesn't ship client deps, `fly.toml:1` (`app=jumpshot`, `primary_region=bom`, `internal_port=8080`, `auto_stop_machines=stop`).

## Working in this repo

- Run `bun run typecheck` before claiming correctness (and `bun run build` if touching client).
- Keep shared constants in sync — never duplicate tick/physics constants in client or server.
- When touching wire protocol or sim, verify against both `packages/shared/src/net.ts:1` and `packages/server/src/room.ts:70` / `packages/client/src/net.ts:7`.
