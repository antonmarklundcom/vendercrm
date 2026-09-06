import { mysqlTable, char, varchar, json, datetime, index, uniqueIndex, text } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// The weekly AI briefing (PLAN.md §15.3 L2, §17.2 P14). One row per tenant
// per ISO week, unique on (tenant_id, week_start) — the idempotency guard
// that makes a re-run of `coach.weekly` a no-op, same role the "already
// sent" column P7 deliberately avoided for the daily digest.

export const coachBriefings = mysqlTable(
  "coach_briefings",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    // Local Monday, stored as that day's midnight instant in the tenant's
    // own timezone (modules/calendar/zoned-time.ts's `startOfDay`) — the
    // same "store the instant, the tenant's clock decides which day" rule
    // every other datetime column in this schema follows.
    weekStart: datetime("week_start").notNull(),
    // The number set the narrative is built from and verified against
    // (narrative.ts's `verifyNarrative`) — never derived again from the
    // narrative text itself.
    metrics: json("metrics").$type<Record<string, number>>().notNull(),
    narrative: text("narrative").notNull(),
    recommendations: json("recommendations").$type<string[]>().notNull(),
    // `template` is what every tenant gets when AI is off, over the cap, or
    // the model's output failed verification — the briefing always exists,
    // the model only improves the prose (§17.3 P14).
    source: varchar("source", { length: 10, enum: ["ai", "template"] }).notNull(),
    aiReplyId: char("ai_reply_id", { length: 26 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("coach_briefings_tenant_id_idx").on(table.tenantId),
    uniqueIndex("coach_briefings_tenant_week_idx").on(table.tenantId, table.weekStart),
  ],
);
