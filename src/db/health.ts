import { pool } from "./client";
import { forceIpv4Loopback } from "./url";
import { env } from "@/lib/config/env";

export type DatabaseCheck = {
  ok: boolean;
  /** Where we actually connected — never includes the password. */
  target: { host: string; port: string; user: string; database: string } | null;
  error?: { code?: string; errno?: number; message: string };
  /**
   * Separate result for a parameterized query (server-side prepared
   * statement, same code path every real query in the app uses) versus the
   * plain-text `SELECT 1` above. Some shared-hosting MySQL setups (a proxy
   * layer in front of the real server, most often) accept plain queries but
   * reject or silently fail prepared statements — which every real query in
   * this app is, since drizzle always parameterizes. Diagnostic only, added
   * 2026-09-05 to chase down a "some queries fail, some don't" incident.
   */
  preparedStatement?: { ok: boolean; error?: { code?: string; errno?: number; message: string } };
};

/**
 * Connectivity probe for the deploy runbook (docs/DEPLOY.md §8): opens a real
 * connection and runs `SELECT 1`, reporting the driver's own error code
 * instead of the empty 500 Next.js returns in production.
 */
export async function checkDatabaseConnection(): Promise<DatabaseCheck> {
  const url = forceIpv4Loopback(env.DATABASE_URL);
  let target: DatabaseCheck["target"] = null;
  try {
    const parsed = new URL(url);
    target = {
      host: parsed.hostname,
      port: parsed.port || "3306",
      user: decodeURIComponent(parsed.username),
      database: parsed.pathname.replace(/^\//, ""),
    };
  } catch {
    // Leave target null — an unparseable URL is itself the finding.
  }

  try {
    const conn = await pool.getConnection();
    let preparedStatement: DatabaseCheck["preparedStatement"];
    try {
      await conn.query("SELECT 1");
      try {
        await conn.execute("SELECT ? AS one", [1]);
        preparedStatement = { ok: true };
      } catch (prepError) {
        const err = prepError as { code?: string; errno?: number; message?: string };
        preparedStatement = {
          ok: false,
          error: { code: err.code, errno: err.errno, message: err.message ?? String(prepError) },
        };
      }
    } finally {
      conn.release();
    }
    return { ok: true, target, preparedStatement };
  } catch (error) {
    const err = error as { code?: string; errno?: number; message?: string };
    return {
      ok: false,
      target,
      error: {
        code: err.code,
        errno: err.errno,
        message: err.message ?? String(error),
      },
    };
  }
}
