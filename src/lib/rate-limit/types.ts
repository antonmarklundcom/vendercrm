export type RateLimitResult = {
  limited: boolean;
  remaining: number;
  resetAt: number;
};

/**
 * One fixed-window limiter implementation. Both drivers answer the same
 * question — "is this key over `limit` within `windowMs`?" — and differ only
 * in where the count lives (PLAN.md §14 I1 #1).
 */
export type RateLimitDriver = {
  name: "memory" | "mysql";
  check(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
};
