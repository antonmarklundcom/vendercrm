CREATE TABLE `rate_limit_buckets` (
	`bucket_key` varchar(191) NOT NULL,
	`hit_count` int NOT NULL DEFAULT 0,
	`reset_at` datetime(3) NOT NULL,
	CONSTRAINT `rate_limit_buckets_bucket_key` PRIMARY KEY(`bucket_key`)
);
--> statement-breakpoint
ALTER TABLE `tenants` ADD `contacts_feed_token_hash` char(64);--> statement-breakpoint
ALTER TABLE `tenants` ADD CONSTRAINT `tenants_contacts_feed_token_hash_idx` UNIQUE(`contacts_feed_token_hash`);--> statement-breakpoint
CREATE INDEX `rate_limit_buckets_reset_at_idx` ON `rate_limit_buckets` (`reset_at`);--> statement-breakpoint
-- Backfill the feed-token hash from the plaintext token already in settings
-- (PLAN.md §14 I1 #2), so existing feed URLs keep resolving after the lookup
-- switches from a scan to an indexed match. MySQL's own SHA2 produces the
-- same hex digest as the app's createHash("sha256") path. Tenants with no
-- token keep a NULL hash, which the unique index allows any number of.
UPDATE `tenants`
SET `contacts_feed_token_hash` = SHA2(JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.exports.contactsToken')), 256)
WHERE JSON_TYPE(JSON_EXTRACT(`settings`, '$.exports.contactsToken')) = 'STRING';
