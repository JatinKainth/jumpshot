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
  let p = port ?? params.get("port") ?? null;

  // Allow ?host=wss://example.com or ws://example.com (or with path/port).
  if (h.startsWith("ws://") || h.startsWith("wss://")) {
    if (p && !/:\d+(\/|$)/.test(h)) {
      try {
        const u = new URL(h);
        u.port = p;
        // URL.toString() always adds trailing slash — strip it if original had none.
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
      ? secureParam !== "0" && secureParam !== "false"
      : window.location.protocol === "https:";

  if (p === null) {
    // No explicit port: same-host dev keeps the page's port, otherwise
    // default to 8080 for ws:// and omit (443) for wss://.
    if (h === window.location.hostname && window.location.port) {
      p = window.location.port;
    } else {
      p = secure ? "" : "8080";
    }
  }

  const scheme = secure ? "wss" : "ws";
  return p ? `${scheme}://${h}:${p}` : `${scheme}://${h}`;
}
