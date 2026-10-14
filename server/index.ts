// Patchwerk room server: one Bun process, Hocuspocus over Bun's websockets.
// The frontend lives elsewhere, so every origin is allowed.
import type { ServerWebSocket } from "bun";
import { Hocuspocus, type WebSocketLike } from "@hocuspocus/server";
import { roomStore } from "./rooms";
import { aiSocket, aiStatus } from "./ai";

const PORT = Number(process.env.PORT ?? 3000);
const DATA = process.env.DATA_DIR ?? "./data/rooms";

type Socket = ServerWebSocket<{ request: Request; ai: boolean; client?: ReturnType<Hocuspocus["handleConnection"]> }>;

const hocuspocus = new Hocuspocus({
  quiet: true,
  extensions: [await roomStore(DATA)],
  async onAuthenticate() {
    // Hackathon: everyone is welcome.
    return {};
  },
});

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const server = Bun.serve<Socket["data"]>({
  port: PORT,
  fetch(request, server) {
    const url = new URL(request.url);
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return server.upgrade(request, { data: { request, ai: url.pathname === "/ai" } }) ? undefined : new Response("upgrade failed", { status: 400 });
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/health") {
      const rooms = [...hocuspocus.documents.entries()].map(([name, doc]) => ({ name, clients: doc.getConnectionsCount() }));
      return Response.json({ ok: true, rooms, ai: aiStatus() }, { headers: CORS });
    }
    return new Response("patchwerk room server. connect a websocket here.", { headers: CORS });
  },
  websocket: {
    open(ws: Socket) {
      if (ws.data.ai) return aiSocket.open(ws);
      ws.data.client = hocuspocus.handleConnection(ws as unknown as WebSocketLike, ws.data.request);
    },
    message(ws: Socket, message) {
      if (ws.data.ai) return aiSocket.message(ws, message);
      const bytes = typeof message === "string" ? new TextEncoder().encode(message) : new Uint8Array(message);
      ws.data.client?.handleMessage(bytes);
    },
    close(ws: Socket, code, reason) {
      if (ws.data.ai) return aiSocket.close(ws);
      ws.data.client?.handleClose({ code, reason });
    },
    // Hocuspocus drops a client it hasn't heard from in 60 s; the provider pings well inside that.
    idleTimeout: 120,
    maxPayloadLength: 16 * 1024 * 1024,
  },
});

console.log(`patchwerk server on ws://localhost:${server.port}  rooms in ${DATA}`);

async function shutdown(): Promise<void> {
  // Flush the debounced room writes before the process goes; closing the last
  // connection of a room stores and unloads it.
  hocuspocus.closeConnections();
  hocuspocus.flushPendingStores();
  const deadline = Date.now() + 3000;
  while (hocuspocus.getDocumentsCount() > 0 && Date.now() < deadline) await Bun.sleep(25);
  server.stop(true);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
