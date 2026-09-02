import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { env } from "@/lib/config/env";
import * as schema from "./schema";
import { forceIpv4Loopback } from "./url";

// Sole raw-connection point in the app — every other module reaches the
// database through the tenancy-scoped wrapper (PLAN.md §3.3), not this file.

/**
 * The limits below are an outage guard, not tuning. With mysql2's defaults
 * (`queueLimit: 0`, no acquire/connect timeout) a request that arrives while
 * every connection is busy waits forever. On Hostinger's shared hosting that
 * is fatal rather than slow: each stuck request keeps its Node process alive,
 * the account-wide "Max Processes" cap (200) fills, and every site on the
 * account answers 503. A request that cannot get a connection must fail in
 * seconds so its process is released. Same fix as propia.node (2026-07-26
 * post-mortem) and trabajo (#81).
 *
 * `connectionLimit` is deliberately small: Hostinger may run several app
 * processes, each with its own pool, and MySQL's per-user limit is the real
 * ceiling (connectionLimit × processes).
 */
export const pool = mysql.createPool({
  uri: forceIpv4Loopback(env.DATABASE_URL),
  connectionLimit: 6,
  maxIdle: 6,
  idleTimeout: 30_000,
  waitForConnections: true,
  queueLimit: 24,
  connectTimeout: 8_000,
});

export const db = drizzle(pool, { schema, mode: "default" });
