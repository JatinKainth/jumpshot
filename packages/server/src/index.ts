import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import {
  decodeClientMsg,
  encodeMsg,
} from "@jumpshot/shared";
import { Room } from "./room";

const port = Number(process.env.PORT ?? process.env.JUMPSHOT_PORT ?? 8080);
const room = new Room();

const http = createServer((req, res) => {
  // Health check for hosted platforms (Fly, Render, etc.)
  if (req.url === "/health" || req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("jumpshot server\n");
});

const wss = new WebSocketServer({ server: http });

room.onBroadcast((msg) => {
  const data = encodeMsg(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
});

wss.on("connection", (ws) => {
  if (room.full) {
    ws.close(4000, "room full");
    return;
  }

  const { id, welcome } = room.join();
  ws.send(encodeMsg(welcome));

  ws.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return;
    }
    const msg = decodeClientMsg(parsed);
    if (msg) room.setInput(id, msg.seq, msg.bits);
  });

  ws.on("close", () => room.leave(id));

  ws.on("error", () => room.leave(id));
});

http.listen(port, "0.0.0.0", () => {
  // Hosted platforms terminate TLS at the edge — the app always speaks ws://
  // internally, but externally it's wss://. Log both so the URL is copy-pasteable.
  console.log(`ws listening on ws://localhost:${port} (0.0.0.0:${port})`);
  for (const ip of lanIps()) {
    console.log(`P2: open http://${ip}:5173 in a browser on the same network`);
  }
  if (process.env.FLY_APP_NAME) {
    console.log(`public wss: wss://${process.env.FLY_APP_NAME}.fly.dev`);
  }
});

function lanIps(): string[] {
  const out: string[] = [];
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (!net.internal && net.family === "IPv4") out.push(net.address);
    }
  }
  return out;
}
