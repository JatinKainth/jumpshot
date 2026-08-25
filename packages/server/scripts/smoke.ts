/**
 * Smoke test against a running server: two clients join; P1 free-roams solo,
 * then the match auto-starts — P1 grabs a floor gun, shoots idle P2, and the
 * round/score FSM reacts. A third client is rejected. Run with the server up:
 *
 *   SMOKE_URL=ws://localhost:8080 bun run scripts/smoke.ts
 */
import WebSocket from "ws";
import {
  decodeServerMsg,
  encodeMsg,
  INPUT,
} from "@jumpshot/shared";
import type {
  GunSnapshot,
  PlayerSnapshot,
  SnapshotMsg,
  WelcomeMsg,
} from "@jumpshot/shared";

const url = process.env.SMOKE_URL ?? "ws://localhost:8080";
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures.push(name);
}

interface Client {
  ws: WebSocket;
  welcomes: WelcomeMsg[];
  snaps: SnapshotMsg[];
}

function connect(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const c: Client = { ws: new WebSocket(url), welcomes: [], snaps: [] };
    c.ws.on("open", () => resolve(c));
    c.ws.on("error", reject);
    wireMessages(c, c.ws);
  });
}

/** Reconnect an existing Client in place (same buffers, fresh socket). */
function reopen(c: Client): Promise<void> {
  return new Promise((resolve, reject) => {
    c.welcomes.length = 0;
    c.snaps.length = 0;
    const ws = new WebSocket(url);
    ws.on("open", () => {
      c.ws = ws;
      resolve();
    });
    ws.on("error", reject);
    wireMessages(c, ws);
  });
}

function wireMessages(c: Client, ws: WebSocket): void {
  ws.on("message", (raw) => {
    const msg = decodeServerMsg(JSON.parse(String(raw)));
    if (!msg) return;
    if (msg.t === "welcome") c.welcomes.push(msg);
    else c.snaps.push(msg);
  });
}

function latest(c: Client): SnapshotMsg | undefined {
  return c.snaps[c.snaps.length - 1];
}

function findPs(s: SnapshotMsg | undefined, id: number): PlayerSnapshot | undefined {
  return s?.ps.find((p) => p[0] === id);
}

function sendBits(c: Client, seq: number, bits: number): void {
  c.ws.send(encodeMsg({ t: "input", seq, bits }));
}

async function main(): Promise<void> {
  const p1 = await connect();
  await waitFor(() => p1.welcomes.length > 0 && p1.snaps.length > 0);
  const id1 = p1.welcomes[0]!.id;
  check("P1 welcomed", p1.welcomes.length === 1);

  // --- Free-roam (wait phase) ---
  await sleep(700);
  const settled = findPs(latest(p1), id1)!;
  check("P1 lands on floor", Math.abs(settled[2] - 218) < 3, `y=${settled[2]}`);
  check("P1 onGround flag set", settled[6] === 1);
  check("starts unarmed", findPs(latest(p1), id1)![9] === 0);

  let seq = 1;
  const xBefore = findPs(latest(p1), id1)![1];
  const mover = setInterval(() => sendBits(p1, seq++, INPUT.RIGHT), 16);
  await sleep(600);
  clearInterval(mover);
  sendBits(p1, seq++, 0);
  await sleep(120);
  const xAfter = findPs(latest(p1), id1)![1];
  check("RIGHT input moves P1", xAfter - xBefore > 40, `${xBefore} -> ${xAfter}`);

  const yBefore = findPs(latest(p1), id1)![2];
  const jumper = setInterval(() => sendBits(p1, seq++, INPUT.JUMP), 16);
  let minY = yBefore;
  const watch = setInterval(() => {
    const p = findPs(latest(p1), id1);
    if (p) minY = Math.min(minY, p[2]);
  }, 10);
  await sleep(450);
  clearInterval(jumper);
  clearInterval(watch);
  sendBits(p1, seq++, 0);
  check("JUMP input lifts P1", minY < yBefore - 20, `minY=${minY} from ${yBefore}`);

  // --- Match auto-starts on second player ---
  const p2 = await connect();
  await waitFor(() => latest(p1)?.ph === "count");
  const id2 = p2.welcomes[0]!.id;
  check("two distinct ids", id1 !== id2, `${id1} vs ${id2}`);

  // Snapshot cadence ~60Hz over a 1s window.
  const countBefore = p1.snaps.length;
  await sleep(1000);
  const hz = p1.snaps.length - countBefore;
  check("snapshot rate ~60Hz", hz >= 50 && hz <= 72, `${hz}/s`);

  await waitFor(() => latest(p1)?.ph === "play", 8000);
  check("countdown reaches play", latest(p1)?.ph === "play");
  check(
    "round reset put P1 back at spawn",
    Math.abs(findPs(latest(p1), id1)![1] - 72) < 3,
    `x=${findPs(latest(p1), id1)![1]}`,
  );

  // --- Round 1: P1 arms up and kills idle P2 ---
  const r1 = await winRound(p1, p2, id2, seq);
  seq = r1.seq;
  check("P1 takes round 1", r1.ok);

  await waitFor(() => latest(p1)?.ph === "rend", 3000).catch(() => {});
  const endSnap = latest(p1)!;
  check("round enters rend", endSnap.ph === "rend");
  check("winner recorded", endSnap.win === id1, `win=${endSnap.win}`);
  check("pip awarded to P1", (endSnap.pip[id1] ?? 0) === 1, JSON.stringify(endSnap.pip));

  // --- Round 2 decides the match; mend then auto-rematch ---
  const r2 = await winRound(p1, p2, id2, seq);
  seq = r2.seq;
  check("P1 takes round 2", r2.ok);

  await waitFor(() => latest(p1)?.ph === "mend", 3000).catch(() => {});
  check("match enters mend", latest(p1)?.ph === "mend");
  check("match winner recorded", latest(p1)?.win === id1, `win=${latest(p1)?.win}`);

  await waitFor(() => latest(p1)?.ph === "count", 8000).catch(() => {});
  const rematch = latest(p1)!;
  check("auto rematch into countdown", rematch.ph === "count");
  check(
    "pips reset on rematch",
    Object.keys(rematch.pip).length === 2 && Object.values(rematch.pip).every((n) => n === 0),
    JSON.stringify(rematch.pip),
  );

  // Room is still full -> reject with 4000.
  const rejected = await new Promise<number | null>((resolve) => {
    const ws = new WebSocket(url);
    ws.on("close", (code) => resolve(code));
    ws.on("error", () => resolve(null));
    setTimeout(() => resolve(null), 2000);
  });
  check("third client rejected with 4000", rejected === 4000, `code=${rejected}`);

  finish(p1, p2);
}

/**
 * Plays out one full round from whatever phase we're in: wait for play, arm up
 * at a floor gun spot, then shoot the idle victim until they drop.
 *
 * The spawner picks uniformly among 5 spots (2 floor-level); if all 3 capped
 * guns roll onto platforms the bot can never arm, so on failure we restart
 * the match (P2 disconnect aborts it) and reroll — each attempt is an
 * independent ~78% success.
 */
async function winRound(
  p1: Client,
  p2: Client,
  victimId: number,
  seq: number,
): Promise<{ ok: boolean; seq: number }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await waitFor(() => latest(p1)?.ph === "play", 15_000).catch(() => {});
    if (latest(p1)?.ph !== "play") return { ok: false, seq };
    const armed = await armUp(p1, seq);
    seq = armed.seq;
    if (armed.ok) {
      const killed = await shootOpponent(p1, victimId, seq);
      seq = killed.seq;
      if (killed.ok) return { ok: true, seq };
    }
    if (attempt === 3) return { ok: false, seq };
    p2.ws.close();
    await waitFor(() => latest(p1)?.ph === "wait", 3000).catch(() => {});
    await reopen(p2);
    victimId = p2.welcomes[0]!.id;
  }
  return { ok: false, seq };
}

/** Patrol the floor-level gun spots until an overlap grants the pistol. */
async function armUp(
  c: Client,
  seq: number,
): Promise<{ ok: boolean; seq: number }> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const snap = latest(c);
    const me = findPs(snap, c.welcomes[0]!.id);
    if (me && me[9] === 1) {
      sendBits(c, seq++, 0);
      return { ok: true, seq };
    }
    const target = nearestFloorGun(snap?.gs ?? [], me);
    const dx = target - (me?.[1] ?? 0);
    const bits =
      (dx > 4 ? INPUT.RIGHT : dx < -4 ? INPUT.LEFT : 0) | INPUT.FIRE;
    sendBits(c, seq++, bits);
    await sleep(16);
  }
  sendBits(c, seq++, 0);
  return { ok: false, seq };
}

function nearestFloorGun(gs: GunSnapshot[], me: PlayerSnapshot | undefined): number {
  const myY = me?.[2] ?? 218;
  // Mid-floor gun spot on the player-spawn row (col 13 × TILE_SIZE + half);
  // patrol target before any gun snapshot shows a floor-level pickup.
  let best = 216;
  let bestDist = Infinity;
  for (const [, gx, gy] of gs) {
    if (Math.abs(gy - myY) > 8) continue;
    const d = Math.abs(gx - (me?.[1] ?? 0));
    if (d < bestDist) {
      bestDist = d;
      best = gx;
    }
  }
  return best;
}

/** Hold RIGHT+FIRE from anywhere left of the victim until their alive flag drops. */
async function shootOpponent(
  c: Client,
  victimId: number,
  seq: number,
): Promise<{ ok: boolean; seq: number }> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const me = findPs(latest(c), c.welcomes[0]!.id);
    if (me && me[1] > 430) {
      // Nearly on top of the victim — stop walking, keep shooting.
      sendBits(c, seq++, INPUT.FIRE);
    } else {
      sendBits(c, seq++, INPUT.RIGHT | INPUT.FIRE);
    }
    const victim = findPs(latest(c), victimId);
    if (victim && victim[8] === 0) {
      sendBits(c, seq++, 0);
      return { ok: true, seq };
    }
    await sleep(16);
  }
  sendBits(c, seq++, 0);
  return { ok: false, seq };
}

function finish(...clients: Client[]): void {
  for (const c of clients) c.ws.close();
  console.log(failures.length === 0 ? "\nALL PASS" : `\n${failures.length} FAILURES`);
  process.exit(failures.length === 0 ? 0 : 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const iv = setInterval(() => {
      if (cond()) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(iv);
        reject(new Error("waitFor timeout"));
      }
    }, 10);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
