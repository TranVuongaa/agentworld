import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { Pool } from "pg";
import { WebSocket, WebSocketServer } from "ws";
import { authorizedProjectSession } from "./sessionAuth";

export interface ProjectRuntime { token: string; port: number; child: { exitCode: number | null; signalCode: NodeJS.Signals | null } }

/** Authenticate a project session on both sides of every proxied frame. */
export function installProjectSocketGateway(server: Server, db: Pool, origin: URL, getRuntime: (id: string) => ProjectRuntime | undefined, forwardUpgrade?: (request: IncomingMessage, socket: Duplex, head: Buffer) => void): WebSocketServer {
const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
function reject(socket: Duplex, status: number) {
  if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} ${status === 403 ? "Forbidden" : "Unauthorized"}\r\nConnection: close\r\n\r\n`);
}
server.on("upgrade", (request, socket, head) => {
  void (async () => {
    const url = new URL(request.url ?? "/", origin);
    if (url.pathname === "/_next/webpack-hmr" && forwardUpgrade) {
      forwardUpgrade(request, socket, head);
      return;
    }
    const match = /^\/api\/projects\/([0-9a-f-]{36})\/ws$/i.exec(url.pathname);
    if (!match || request.headers.origin !== origin.origin) return reject(socket, 403);
    const projectId = match[1];
    if (!await authorizedProjectSession(db, request.headers.cookie, projectId)) return reject(socket, 401);
    const runtime = getRuntime(projectId);
    if (!runtime || runtime.child.exitCode !== null || runtime.child.signalCode !== null) return reject(socket, 401);
    sockets.handleUpgrade(request, socket, head, (browser) => {
      const backend = new WebSocket(`ws://127.0.0.1:${runtime.port}/ws?token=${runtime.token}`, { origin: origin.origin, maxPayload: 1024 * 1024 });
      const queue: Array<{ data: Buffer; binary: boolean }> = [];
      let pending = Promise.resolve();
      let outgoing = Promise.resolve();
      let incomingCount = 0, outgoingCount = 0;
      let closed = false;
      const close = (code = 1000) => {
        if (closed) return;
        closed = true;
        clearInterval(checkTimer);
        if (browser.readyState === WebSocket.OPEN) browser.close(code);
        else if (browser.readyState === WebSocket.CONNECTING) browser.terminate();
        if (backend.readyState === WebSocket.OPEN) backend.close();
        else if (backend.readyState === WebSocket.CONNECTING) backend.terminate();
      };
      const authorized = () => authorizedProjectSession(db, request.headers.cookie, projectId);
      const checkTimer = setInterval(() => { void authorized().then((ok) => { if (!ok) close(1008); }).catch(() => close(1011)); }, 5000);
      backend.on("open", () => { while (queue.length && backend.readyState === WebSocket.OPEN) { const item = queue.shift()!; backend.send(item.data, { binary: item.binary }); } });
      backend.on("message", (data, binary) => {
        if (++outgoingCount > 100) return close(1011);
        outgoing = outgoing.then(async () => {
          if (closed) return;
          if (!await authorized()) return close(1008);
          if (browser.readyState === WebSocket.OPEN && browser.bufferedAmount < 2 * 1024 * 1024) browser.send(data, { binary });
          else close(1011);
        }).catch(() => close(1011)).finally(() => { outgoingCount--; });
      });
      browser.on("message", (data, binary) => {
        if (++incomingCount > 100) return close(1011);
        const body = Buffer.isBuffer(data) ? data : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data)]);
        pending = pending.then(async () => {
          if (closed) return;
          if (!await authorized()) return close(1008);
          if (backend.readyState === WebSocket.OPEN && backend.bufferedAmount < 2 * 1024 * 1024) backend.send(body, { binary });
          else if (backend.readyState === WebSocket.CONNECTING && queue.length < 100) queue.push({ data: body, binary });
          else close(1011);
        }).catch(() => close(1011)).finally(() => { incomingCount--; });
      });
      browser.on("close", () => close()); browser.on("error", () => close(1011));
      backend.on("close", () => close(1011)); backend.on("error", () => close(1011));
    });
  })().catch(() => reject(socket, 401));
});
return sockets;
}
