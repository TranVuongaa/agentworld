import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export default function config(phase) {
  return {
    outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  };
}
