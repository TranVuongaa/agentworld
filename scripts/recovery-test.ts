import assert from "node:assert/strict";
import { Recovery } from "../server/saas/recovery";

const recovery = new Recovery(5, 20, 30);
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
let attempts = 0;
recovery.schedule("one", async () => { attempts++; if (attempts < 3) throw new Error("temporary failure"); return true; });
await pause(100);
assert.equal(attempts, 3, "failed restarts must be retried");
let cancelled = 0;
recovery.schedule("two", async () => { cancelled++; return true; });
recovery.cancel("two");
await pause(30);
assert.equal(cancelled, 0, "cancelled projects must not restart");
let removed = 0;
recovery.schedule("removed", async () => { removed++; return false; });
await pause(50);
assert.equal(removed, 1, "removed projects must not retry");
console.log("Project recovery retries failures and respects cancellation");
