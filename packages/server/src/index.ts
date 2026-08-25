import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import {
  decodeClientMsg,
  encodeMsg,
} from "@jumpshot/shared";
import { Room } from "./room";

const port = Number(process.env.JUMPSHOT_PORT ?? 8080);
const room = new Room();

const http = createServer((_req, res) => {
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

http.listen(port, () => {
  console.log(`ws listening on ws://localhost:${port}`);
  for (const ip of lanIps()) {
    console.log(`P2: open http://${ip}:5173 in a browser on the same network`);
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
