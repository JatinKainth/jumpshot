# jumpshot

Pixel platformer duel — Mario-like movement, guns spawn around the map,
2 players on the same network shoot it out. 1 life per round, best of 3.

See [PLAN.md](./PLAN.md) for the full design and roadmap.

## Status

| Milestone        | State |
| ---------------- | ----- |
| M0 local shell   | ✅ done |
| M1 netplay       | ✅ done |
| M2 combat        | ✅ done |
| M3 polish        | ✅ done |

M0: controllable square on a static platform map, rendered from shared level
data.

M1: authoritative WS server simulating both players at 60Hz. Clients send input
bitmasks on change, predict their own player locally (reconciled against
snapshots), and interpolate the remote player ~50ms behind.

M2: pistols spawn every 3s at random free spawnpoints (cap 3 on map). Pick up
by overlap, fire with click/space; bullets are server-simulated with substep
integration so they can't tunnel through walls. 1 life per round, round ends
on a death (simultaneous kill = draw + replay), first to 2 wins takes the
match — countdown/round-end/match-end phases drive a scoreboard overlay and
HUD round pips.

M3: connection menu before play, Pixel Adventure character sprites + anims
(idle/run/jump/fall/dead) on a tile-art terrain, Kenney CC0 sound effects
(fire/jump/pickup/death-beeps/win), and game juice — muzzle flashes, death
particle bursts + camera shake, gun-spawn pops, squash-and-stretch. `M` mutes.

Art credits: characters + terrain tiles from [Pixel Frog's Pixel Adventure 1](https://pixelfrog-assets.itch.io/pixel-adventure-1)
(free for commercial/noncommercial use); audio from [Kenney](https://kenney.nl)
audio packs (CC0).

## Run

Requires [bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`).

```sh
bun install
bun run server   # terminal 1 — ws on :8080, prints your LAN IP
bun run dev      # terminal 2 — client on :5173
```

P1 opens http://localhost:5173, P2 opens `http://<LAN-IP>:5173` (the server
prints it). Both connect to `ws://<host>:5173's host:8080` automatically.
Override with `?host=x.x.x.x&port=8080` query params; server port via
`JUMPSHOT_PORT=...`.

Other commands:

```sh
bun run typecheck   # tsc across shared + server + client
bun run build       # production bundle in packages/client/dist
```

### GitHub Pages

The client is deployed to https://jatinkainth.github.io/jumpshot/ on every push
to `main` (`.github/workflows/deploy.yml`). Pages serves only the static
client — the authoritative WS server still has to run somewhere. Because
`github.io` is HTTPS-only, browsers block `ws://` connections from it, so the
deployed page can't reach a LAN server; play over Pages becomes possible once
the server is hosted behind `wss://` (see M4 in [PLAN.md](./PLAN.md)).

## Controls

- Move: `A`/`D` or `←`/`→`
- Jump: `Space`, `W`, or `↑` (release early = shorter jump)
- Fire: `Space` or click
- Mute: `M`

## Layout

```
packages/
├── shared/   # constants, types, level data + parser, sim + wire protocol (@jumpshot/shared)
├── client/   # Phaser renderer: prediction (self) + interpolation (remote)
└── server/   # authoritative 60Hz sim, ws input/snapshot relay (@jumpshot/server)
```
