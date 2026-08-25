/**
 * Smoke test against a running server: two clients join, gravity settles them,
 * input moves/jumps P1, a third client is rejected. Run with the server up:
 *
 *   SMOKE_URL=ws://localhost:8080 bun run scripts/smoke.ts
 */
import WebSocket from "ws";
import { decodeServerMsg, encodeMsg } from "@jumpshot/shared";
import type { PlayerSnapshot, SnapshotMsg, WelcomeMsg } from "@jumpshot/shared";
import { INPUT } from "@jumpshot/shared";

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
    c.ws.on("message", (raw) => {
      const msg = decodeServerMsg(JSON.parse(String(raw)));
      if (!msg) return;
      if (msg.t === "welcome") c.welcomes.push(msg);
      else c.snaps.push(msg);
    });
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

  // Let P1 fall from spawn and settle on the floor.
  await sleep(700);
  const settled = findPs(latest(p1), id1)!;
  check("P1 lands on floor", Math.abs(settled[2] - 218) < 3, `y=${settled[2]}`);
  check("P1 onGround flag set", settled[6] === 1);

  const p2 = await connect();
  await waitFor(() => p2.snaps.some((s) => s.ps.length === 2));
  const id2 = p2.welcomes[0]!.id;
  check("two distinct ids", id1 !== id2, `${id1} vs ${id2}`);

  // Snapshot cadence ~60Hz over a 1s window.
  const countBefore = p1.snaps.length;
  await sleep(1000);
  const hz = p1.snaps.length - countBefore;
  check("snapshot rate ~60Hz", hz >= 50 && hz <= 72, `${hz}/s`);

  // Hold RIGHT: P1 x should climb well past walk distance * half the window.
  const xBefore = findPs(latest(p1), id1)![1];
  let seq = 1;
  const mover = setInterval(() => sendBits(p1, seq++, INPUT.RIGHT), 16);
  await sleep(600);
  clearInterval(mover);
  sendBits(p1, seq++, 0);
  await sleep(120);
  const xAfter = findPs(latest(p1), id1)![1];
  check("RIGHT input moves P1", xAfter - xBefore > 40, `${xBefore} -> ${xAfter}`);

  // Jump from rest: y should dip well above the floor line.
  await sleep(400); // let any residual velocity die out
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

  // P2 sees P1 moving (remote state actually propagates).
  const p1FromP2 = findPs(latest(p2), id1)!;
  check(
    "P2 receives P1's motion",
    Math.abs(p1FromP2[1] - xAfter) < 40,
    `dx=${Math.abs(p1FromP2[1] - xAfter)}`,
  );

  // Room is full -> reject with 4000.
  const rejected = await new Promise<number | null>((resolve) => {
    const ws = new WebSocket(url);
    ws.on("close", (code) => resolve(code));
    ws.on("error", () => resolve(null));
    setTimeout(() => resolve(null), 2000);
  });
  check("third client rejected with 4000", rejected === 4000, `code=${rejected}`);

  p1.ws.close();
  p2.ws.close();

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
