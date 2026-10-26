import type { Server } from "node:http";
import { createApp } from "./app";
import { assertAuthConfig, config } from "./config";
import { pool } from "./db/pool";
import { ensureAdmin } from "./modules/auth/bootstrapAdmin";
import { syncNextSeq } from "./modules/units/unit.service";

let server: Server | undefined;

async function start(): Promise<void> {
  assertAuthConfig();
  await ensureAdmin();
  // Bring every module's "next serial" in line with the units that exist.
  await syncNextSeq();

  const app = createApp();
  server = app.listen(config.port, () => {
    console.log(
      `Stockroom API listening on http://localhost:${config.port} (${config.nodeEnv})`,
    );
  });
}

start().catch((err) => {
  console.error("startup failed:", err instanceof Error ? err.message : err);
  pool.end().finally(() => process.exit(1));
});

function shutdown(signal: string): void {
  console.log(`\n${signal} received — shutting down gracefully...`);
  if (!server) process.exit(0);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  // Force-exit if connections don't drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown(signal));
}
