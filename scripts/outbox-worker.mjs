#!/usr/bin/env node
/**
 * Outbox worker: delivers queued notifications, invitations, distributions and destination confirmations.
 * Shares packages/delivery/outbox-store.ts with the web server (which also runs small inline batches because the
 * free host has no background worker). Run: npm run worker:outbox  (add --loop to keep polling every 30 s).
 */
import pg from "pg";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {processOutbox} from "../packages/delivery/outbox-store.ts";

const batchSize = Math.max(1, Math.min(100, Number(process.env.OUTBOX_BATCH_SIZE || 25)));

export async function runOutboxBatch(pool, limit = batchSize) {
  return processOutbox(pool, {limit});
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("postgres")) throw new Error("DATABASE_URL must be a PostgreSQL connection string.");
  const pool = new pg.Pool({connectionString: url, max: 2, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 10_000});
  const loop = process.argv.includes("--loop");
  let stop = false;
  process.on("SIGTERM", () => { stop = true; });
  process.on("SIGINT", () => { stop = true; });
  try {
    do {
      const summary = await runOutboxBatch(pool);
      console.log("Outbox batch:", JSON.stringify(summary));
      if (loop && !stop) await new Promise(r => setTimeout(r, 30_000));
    } while (loop && !stop);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Outbox worker failed.");
    process.exitCode = 1;
  } finally { await pool.end(); }
}
