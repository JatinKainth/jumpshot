import {
  decodeServerMsg,
  encodeMsg,
} from "@jumpshot/shared";
import type { SnapshotMsg, WelcomeMsg } from "@jumpshot/shared";

export class NetClient {
  private ws: WebSocket | null = null;
  private closedByUs = false;
  private retryTimer: number | null = null;
  private lastSentBits = -1;
  private lastSentSeq = -1_000_000;
  private lastActiveSeq = -1_000_000;
  // ?flood=1 forces per-step sends for A/B testing.
  private readonly flood: boolean;
  private readonly host?: string;
  private readonly port?: string;

  constructor(opts: { flood?: boolean; host?: string; port?: string } = {}) {
    this.flood = opts.flood ?? false;
    this.host = opts.host;
    this.port = opts.port;
  }

  onWelcome: ((msg: WelcomeMsg) => void) | null = null;
  onSnapshot: ((msg: SnapshotMsg) => void) | null = null;
  onStatus: ((status: "connecting" | "open" | "closed" | "full") => void) | null =
    null;

  connect(): void {
    this.closedByUs = false;
    this.lastSentBits = -1;
    this.lastSentSeq = -1_000_000;
    this.lastActiveSeq = -1_000_000;
    this.onStatus?.("connecting");
    const ws = new WebSocket(wsUrl(this.host, this.port));
    this.ws = ws;

    ws.onopen = () => this.onStatus?.("open");
    ws.onclose = (ev) => {
      this.ws = null;
      if (ev.code === 4000) {
        this.onStatus?.("full");
        return;
      }
      this.onStatus?.("closed");
      if (!this.closedByUs && this.retryTimer === null) {
        this.retryTimer = window.setTimeout(() => {
          this.retryTimer = null;
          this.connect();
        }, 1500);
      }
    };
    ws.onmessage = (ev) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const msg = decodeServerMsg(parsed);
      if (!msg) return;
      if (msg.t === "welcome") this.onWelcome?.(msg);
      else this.onSnapshot?.(msg);
    };
  }

  sendInput(seq: number, bits: number): void {
    // Flood while active (keys held or just released), sparse while idle.
    // Client/server timelines misalign by a few ticks at every input
    // transition; sparse sends during motion let that error persist and
    // amplify through jumps and wall clamps (harness: 26px avg 11px vs flood
    // 7px max). An idle player is motionless, so sparse sends are safe there;
    // the stale rule doubles as a liveness signal for the server idle timeout.
    const active = bits !== 0 || seq - this.lastActiveSeq <= 15;
    const changed = bits !== this.lastSentBits;
    const stale = seq - this.lastSentSeq > 8;
    if (!this.flood && !active && !changed && !stale) return;
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (bits !== 0) this.lastActiveSeq = seq;
    this.lastSentBits = bits;
    this.lastSentSeq = seq;
    this.ws.send(encodeMsg({ t: "input", seq, bits }));
  }

  destroy(): void {
    this.closedByUs = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
  }
}

function wsUrl(host?: string, port?: string): string {
  const params = new URLSearchParams(window.location.search);
  let h = host ?? params.get("host") ?? window.location.hostname;
  const rawPort = port ?? params.get("port") ?? null;
  let p: string | null = rawPort;

  // Allow ?host=wss://example.com or ws://example.com (or with path/port).
  // Explicit ?port overrides host-embedded port (unlike the previous guard).
  if (h.startsWith("ws://") || h.startsWith("wss://")) {
    if (p !== null) {
      try {
        const u = new URL(h);
        u.port = p;
        // Omit default ports (wss:443, ws:80) for canonical URLs.
        if ((u.protocol === "wss:" && u.port === "443") || (u.protocol === "ws:" && u.port === "80")) {
          u.port = "";
        }
        const raw = u.toString();
        return h.endsWith("/") ? raw : raw.replace(/\/$/, "");
      } catch {
        return h;
      }
    }
    return h;
  }

  const secureParam = params.get("secure") ?? params.get("wss") ?? params.get("tls");
  const secure =
    secureParam !== null
      ? secureParam === "" || (secureParam !== "0" && secureParam.toLowerCase() !== "false")
      : window.location.protocol === "https:";

  if (p === null || p === "") {
    // No explicit port (or explicit empty meaning "use protocol default").
    // For ws: always use the server port (8080) — even if vite moves from 5173
    // (vite.config.ts:7) the WS server stays on 8080. For wss: reuse the page
    // port when same-host (hosted behind same origin), otherwise omit => 443.
    const sameHost = h === window.location.hostname;
    const pagePort = window.location.port;
    if (secure && sameHost && pagePort) {
      p = pagePort;
    } else if (sameHost) {
      p = "8080";
    } else {
      p = secure ? "" : "8080";
    }
  }

  const scheme = secure ? "wss" : "ws";
  // Omit default ports for canonical form.
  if ((scheme === "wss" && p === "443") || (scheme === "ws" && p === "80")) p = "";
  return p ? `${scheme}://${h}:${p}` : `${scheme}://${h}`;
}
