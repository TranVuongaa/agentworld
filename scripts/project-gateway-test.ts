import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import nextEnv from "@next/env";
import pg from "pg";
import { WebSocket, WebSocketServer } from "ws";
import { installProjectSocketGateway } from "../server/saas/projectGateway";
import { Projects } from "../server/saas/projects";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const owner = randomUUID(), stranger = randomUUID();
const ownerToken = randomBytes(32).toString("base64url"), strangerToken = randomBytes(32).toString("base64url");
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const githubUser = String(Math.floor(Math.random() * 1000000000) + 2000000000);
const installation = String(Math.floor(Math.random() * 1000000000) + 2000000000);
const listen = (server: Server) => new Promise<number>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)); });
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));
const backendServer = createServer();
const backendSockets = new WebSocketServer({ server: backendServer });
const gatewayServer = createServer();
let gatewaySockets: WebSocketServer | null = null;
let browser: WebSocket | null = null;
let received = 0;
const denied = (url: string, origin: string, cookie?: string) => new Promise<number>((resolve, reject) => {
  const socket = new WebSocket(url, { origin, ...(cookie ? { headers: { Cookie: cookie } } : {}) });
  socket.once("open", () => { socket.terminate(); reject(new Error("Unauthorized socket opened")); });
  socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
  socket.once("error", reject);
});
try {
  await db.query("INSERT INTO saas_users (id, github_user_id, github_login) VALUES ($1, $3, 'socket-owner'), ($2, $3::bigint + 1, 'socket-other')", [owner, stranger, githubUser]);
  await db.query("INSERT INTO saas_github_installations (id, user_id, account_login) VALUES ($1, $2, 'socket-owner')", [installation, owner]);
  const project = await new Projects(db).create(owner, { installationId: installation, repositoryId: installation, repositoryFullName: "socket-owner/test", name: "Gateway fixture" });
  await db.query("INSERT INTO saas_sessions (token_hash, user_id, expires_at) VALUES ($1,$2,now()+interval '1 hour'),($3,$4,now()+interval '1 hour')", [hash(ownerToken), owner, hash(strangerToken), stranger]);
  const backendPort = await listen(backendServer);
  backendSockets.on("connection", (socket, request) => {
    assert.equal(new URL(request.url ?? "/", "http://127.0.0.1").searchParams.get("token"), "internal-fixture-token");
    socket.send(JSON.stringify({ type: "snapshot" }));
    socket.on("message", (data) => { received++; socket.send(data); });
  });
  const gatewayPort = await listen(gatewayServer);
  const origin = new URL(`http://127.0.0.1:${gatewayPort}`);
  gatewaySockets = installProjectSocketGateway(gatewayServer, db, origin, (id) => id === project.id ? { port: backendPort, token: "internal-fixture-token", child: { exitCode: null, signalCode: null } } : undefined);
  const url = `ws://127.0.0.1:${gatewayPort}/api/projects/${project.id}/ws`;
  assert.equal(await denied(url, origin.origin), 401);
  assert.equal(await denied(url, origin.origin, `agentworld_session=${strangerToken}`), 401);
  assert.equal(await denied(url, "https://untrusted.example", `agentworld_session=${ownerToken}`), 403);
  browser = new WebSocket(url, { origin: origin.origin, headers: { Cookie: `agentworld_session=${ownerToken}` } });
  await new Promise<void>((resolve, reject) => { browser!.once("error", reject); browser!.once("message", () => resolve()); });
  const echo = new Promise<string>((resolve) => browser!.once("message", (data) => resolve(data.toString())));
  browser.send("authorized"); assert.equal(await echo, "authorized"); assert.equal(received, 1);
  await db.query("DELETE FROM saas_sessions WHERE token_hash = $1", [hash(ownerToken)]);
  const disconnected = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Socket was not revoked")), 8000); browser!.once("close", () => { clearTimeout(timer); resolve(); }); });
  browser.send("after-logout"); await disconnected; assert.equal(received, 1);
  console.log("Project socket gateway enforces ownership, origin and session revocation");
} finally {
  browser?.terminate(); gatewaySockets?.clients.forEach((s) => s.terminate()); backendSockets.clients.forEach((s) => s.terminate());
  await Promise.all([close(gatewayServer), close(backendServer)]);
  await db.query("DELETE FROM saas_users WHERE id = ANY($1::uuid[])", [[owner, stranger]]); await db.end();
}
