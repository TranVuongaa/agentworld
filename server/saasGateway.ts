// Local SaaS gateway. Project sockets are authenticated here and never expose
// their private coordinator tokens or ports to the browser.
import { createServer } from "node:http";
import next from "next";
import pg from "pg";
import { installProjectSocketGateway, type ProjectRuntime } from "./saas/projectGateway";

interface Registry { running: Map<string, ProjectRuntime> }
const origin = new URL(process.env.SAAS_APP_URL || "http://127.0.0.1:7420");
if (process.env.SAAS_LOCAL_DEV !== "1" || origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || !process.env.DATABASE_URL) throw new Error("The local gateway requires loopback SAAS_APP_URL, DATABASE_URL and SAAS_LOCAL_DEV=1");
const port = Number(origin.port || 80);
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sink = createServer();
const app = next({ dev: true, dir: process.cwd(), hostname: "127.0.0.1", port, httpServer: sink });
await app.prepare();
const server = createServer(app.getRequestHandler());
const sockets = installProjectSocketGateway(server, db, origin, (projectId) => {
  const registry = (globalThis as typeof globalThis & { agentworldRuntimeRegistry?: Registry }).agentworldRuntimeRegistry;
  return registry?.running.get(projectId);
}, (request, socket, head) => { if (!sink.emit("upgrade", request, socket, head)) socket.destroy(); });
server.listen(port, "127.0.0.1", () => console.log(`Agentworld local: ${origin.origin}`));
const stop = () => { sockets.clients.forEach((client) => client.terminate()); server.close(); void db.end(); process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
