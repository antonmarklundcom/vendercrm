export interface StorageAdapter {
  put(key: string, data: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
  /**
   * Deletes every object whose key starts with `prefix` (e.g. a tenant's
   * `whatsapp-media/<tenantId>/`). Used for tenant-storage cleanup, where a
   * business's key layout is `<kind>/<tenantId>/...` — the prefix names one
   * kind for one tenant, never the whole bucket. Best-effort by contract:
   * implementations count what they deleted and what they couldn't, rather
   * than throwing, so a caller sweeping several prefixes can keep going.
   */
  deletePrefix(prefix: string): Promise<{ deleted: number; failed: number }>;
}
