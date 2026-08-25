# jumpshot

Pixel platformer duel — Mario-like movement, guns spawn around the map,
2 players on the same network shoot it out. 1 life per round, best of 3.

See [PLAN.md](./PLAN.md) for the full design and roadmap.

## Status

| Milestone        | State |
| ---------------- | ----- |
| M0 local shell   | ✅ done |
| M1 netplay       | ✅ done |
| M2 combat        | ⬜ not started |
| M3 polish        | ⬜ not started |

M0: controllable square on a static platform map, rendered from shared level
data.

M1: authoritative WS server simulating both players at 60Hz. Clients send input
bitmasks on change, predict their own player locally (reconciled against
snapshots), and interpolate the remote player ~50ms behind.

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

## Controls

- Move: `A`/`D` or `←`/`→`
- Jump: `Space`, `W`, or `↑` (release early = shorter jump)

## Layout

```
packages/
├── shared/   # constants, types, level data + parser, sim + wire protocol (@jumpshot/shared)
├── client/   # Phaser renderer: prediction (self) + interpolation (remote)
└── server/   # authoritative 60Hz sim, ws input/snapshot relay (@jumpshot/server)
```
