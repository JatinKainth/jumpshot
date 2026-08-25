export class Hud {
  private el: HTMLDivElement;
  private dbgEl: HTMLDivElement;

  constructor() {
    this.el = document.createElement("div");
    const s = this.el.style;
    s.position = "fixed";
    s.display = "none";
    s.font = "bold 14px ui-monospace, Menlo, monospace";
    s.color = "#94b0c2";
    s.background = "rgba(13, 14, 21, 0.75)";
    s.padding = "4px 8px";
    s.borderRadius = "4px";
    s.pointerEvents = "none";
    s.whiteSpace = "pre";
    s.zIndex = "10";
    document.body.appendChild(this.el);

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

  set(text: string): void {
    this.el.textContent = text;
    this.el.style.display = text ? "block" : "none";
    const canvas = document.querySelector("canvas");
    if (!canvas || !text) return;
    const r = canvas.getBoundingClientRect();
    this.el.style.left = `${Math.round(r.left + 12)}px`;
    this.el.style.top = `${Math.round(r.top + 10)}px`;
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
