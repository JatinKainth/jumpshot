import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "@jumpshot/shared";

const HOST_KEY = "jumpshot.host";
const PORT_KEY = "jumpshot.port";

// URL params win over localStorage so ?host=/?port= stay usable after a
// session has saved values.
export function lastConnection(): { host: string; port: string } | null {
  const params = new URLSearchParams(window.location.search);
  const host = params.get("host") ?? localStorage.getItem(HOST_KEY);
  const port = params.get("port") ?? localStorage.getItem(PORT_KEY) ?? "";
  return host ? { host, port } : null;
}

function initialInput(urlKey: string, storageKey: string, fallback: string): string {
  return (
    new URLSearchParams(window.location.search).get(urlKey) ??
    localStorage.getItem(storageKey) ??
    fallback
  );
}

export class MenuScene extends Phaser.Scene {
  private els: HTMLElement[] = [];

  constructor() {
    super("MenuScene");
  }

  create(): void {
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT * 0.24, "JUMPSHOT", {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "52px",
        color: "#ffffff",
        stroke: "#1a1c2c",
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    const defaultPort = window.location.protocol === "https:" ? "" : "8080";
    const hostInput = this.makeInput(initialInput("host", HOST_KEY, window.location.hostname));
    const portInput = this.makeInput(initialInput("port", PORT_KEY, defaultPort));
    const playBtn = document.createElement("button");
    playBtn.textContent = "PLAY";
    Object.assign(playBtn.style, {
      font: "bold 14px ui-monospace, Menlo, monospace",
      color: "#ffffff",
      background: "#e43b44",
      border: "none",
      borderRadius: "4px",
      padding: "8px 20px",
      cursor: "pointer",
    });

    const panel = document.createElement("div");
    const s = panel.style;
    for (const el of [this.label("HOST"), hostInput, this.label("PORT"), portInput, playBtn]) {
      panel.appendChild(el);
    }
    Object.assign(s, {
      position: "fixed",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      font: "bold 14px ui-monospace, Menlo, monospace",
      color: "#94b0c2",
      background: "rgba(13, 14, 21, 0.85)",
      padding: "16px",
      borderRadius: "4px",
      zIndex: "10",
    });
    document.body.appendChild(panel);
    this.els.push(panel);

    // Scale.FIT recenters the canvas on resize, so the panel must follow.
    const canvas = document.querySelector("canvas");
    if (canvas) {
      const position = () => {
        const r = canvas!.getBoundingClientRect();
        s.left = `${Math.round(r.left + r.width / 2)}px`;
        s.top = `${Math.round(r.top + r.height * 0.42)}px`;
        s.transform = "translateX(-50%)";
      };
      position();
      window.addEventListener("resize", position);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        window.removeEventListener("resize", position);
      });
    }

    const play = () => {
      const host = hostInput.value.trim();
      const port = portInput.value.trim();
      if (!host) return;
      localStorage.setItem(HOST_KEY, host);
      localStorage.setItem(PORT_KEY, port);
      this.scene.start("GameScene");
    };
    playBtn.addEventListener("click", play);
    for (const input of [hostInput, portInput]) {
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") play();
      });
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const el of this.els) el.remove();
      this.els.length = 0;
    });
  }

  private label(text: string): HTMLDivElement {
    const el = document.createElement("div");
    el.textContent = text;
    return el;
  }

  private makeInput(value: string): HTMLInputElement {
    const el = document.createElement("input");
    el.value = value;
    el.spellcheck = false;
    Object.assign(el.style, {
      font: "14px ui-monospace, Menlo, monospace",
      color: "#ffffff",
      background: "#0d0e15",
      border: "1px solid #577095",
      borderRadius: "4px",
      padding: "6px 8px",
      outline: "none",
    });
    this.els.push(el);
    return el;
  }
}
