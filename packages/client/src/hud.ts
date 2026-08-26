/** ?debug overlay — the only DOM HUD element; all gameplay text is Phaser. */
export class Hud {
  private dbgEl: HTMLDivElement;

  constructor() {
    this.dbgEl = document.createElement("div");
    const d = this.dbgEl.style;
    d.position = "fixed";
    d.display = "none";
    d.font = "12px ui-monospace, Menlo, monospace";
    d.color = "#7fd18a";
    d.background = "rgba(13, 14, 21, 0.85)";
    d.padding = "4px 8px";
    d.borderRadius = "4px";
    d.pointerEvents = "none";
    d.whiteSpace = "pre";
    d.zIndex = "10";
    document.body.appendChild(this.dbgEl);
  }

  debug(text: string): void {
    this.dbgEl.textContent = text;
    this.dbgEl.style.display = text ? "block" : "none";
    const canvas = document.querySelector("canvas");
    if (!canvas || !text) return;
    const r = canvas.getBoundingClientRect();
    this.dbgEl.style.left = `${Math.round(r.left + 12)}px`;
    this.dbgEl.style.top = `${Math.round(r.bottom - 60)}px`;
  }
}
