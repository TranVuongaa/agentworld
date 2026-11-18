// 127.0.0.1 only. Routes:
//   GET  /ws?token=…            browser WebSocket (browser token)
//   POST /hook/<agent>/<event>  Claude Code hooks (agent token)
//   GET  /api/health
//   GET  /*                     the Next.js application

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type { OfficeEvent } from "../src/data/source";
import { handleHook } from "./hooks";
import type { Hub } from "./hub";
import type { Inbox } from "./inbox";
import { handleMcp } from "./mcp";
import type { Planner } from "./planner";
import { log } from "./lib/log";

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function readBody(req: IncomingMessage, limit = 256 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) reject(new Error("too large"));
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

interface Options {
  hub: Hub;
  inbox: Inbox;
  planner: Planner;
  port: number;
  dev: boolean;
  browserToken: string;
  agentToken: string;
  nextHandler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  nextUpgrade: (req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => Promise<void>;
  allowedOrigins: string[];
  commands: Record<string, (...args: unknown[]) => unknown>;
}

export function startHttp(o: Options) {
  const send = (res: ServerResponse, code: number, body: string, type = "text/plain") => {
    res.writeHead(code, { "Content-Type": type });
    res.end(body);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "POST" && url.pathname.startsWith("/hook/")) {
      const auth = req.headers.authorization ?? "";
      if (!safeEqual(auth, `Bearer ${o.agentToken}`)) return send(res, 401, "unauthorized");
      const [, , agentId, event] = url.pathname.split("/");
      try {
        const body = await readBody(req);
        const r = handleHook(o.hub, o.inbox, decodeURIComponent(agentId ?? ""), event ?? "", body ? JSON.parse(body) : {});
        if (!r.ok) return send(res, 404, "");
        if (r.response) return send(res, 200, JSON.stringify(r.response), "application/json");
        res.writeHead(204);
        return void res.end();
      } catch {
        return send(res, 400, "bad request");
      }
    }

    // Team MCP: agent token + the agent's id (written into its MCP config by HQ).
    if (url.pathname === "/mcp") {
      const auth = req.headers.authorization ?? "";
      const agentId = String(req.headers["x-hq-agent"] ?? "");
      if (!safeEqual(auth, `Bearer ${o.agentToken}`) || !o.hub.cfg(agentId)) return send(res, 401, "unauthorized");
      if (req.method === "GET" || req.method === "DELETE") return send(res, 405, "stateless server");
      try {
        const raw = await readBody(req, 1024 * 1024);
        return await handleMcp(o.hub, o.planner, agentId, req, res, raw ? JSON.parse(raw) : undefined);
      } catch {
        return res.headersSent ? void res.end() : send(res, 400, "bad request");
      }
    }

    if (url.pathname === "/api/health") return send(res, 200, JSON.stringify({ ok: true }), "application/json");

    await o.nextHandler(req, res);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/ws") {
      if (o.dev && url.pathname === "/_next/webpack-hmr") {
        void o.nextUpgrade(req, socket, head);
        return;
      }
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return socket.destroy();
    }
    const origin = req.headers.origin ?? "";
    const token = url.searchParams.get("token") ?? "";
    // Token + origin: another website in your browser can't drive HQ.
    if (!safeEqual(token, o.browserToken) || (origin && !o.allowedOrigins.includes(origin))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => onClient(ws));
  });

  function onClient(ws: WebSocket) {
    const sendEvent = (e: OfficeEvent) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(e));
    sendEvent({ type: "snapshot", snapshot: o.hub.snap });
    const unsub = o.hub.subscribe(sendEvent);
    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { cmd?: string; args?: unknown[] };
        const fn = msg.cmd ? o.commands[msg.cmd] : undefined;
        if (!fn) return log.warn("unknown command", msg.cmd);
        await fn(...(Array.isArray(msg.args) ? msg.args : []));
      } catch (err) {
        log.warn("command failed:", err instanceof Error ? err.message : err);
      }
    });
    ws.on("close", () => unsub());
  }

  return new Promise<typeof server>((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.port, "127.0.0.1", () => resolve(server));
  });
}
