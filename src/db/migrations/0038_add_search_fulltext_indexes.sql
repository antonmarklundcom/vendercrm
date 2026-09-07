-- Custom SQL migration file, put your code below! --

-- FULLTEXT indexes backing the ⌘K search palette (src/modules/crm/search.ts).
-- Drizzle's mysql-core index() builder only emits btree/hash indexes, so
-- these are hand-written here rather than declared in src/db/schema — the
-- schema's TypeScript shape for these tables is unchanged.
ALTER TABLE `contacts` ADD FULLTEXT INDEX `contacts_name_email_fulltext_idx` (`name`, `email`);
--> statement-breakpoint
ALTER TABLE `deals` ADD FULLTEXT INDEX `deals_title_fulltext_idx` (`title`);
--> statement-breakpoint
ALTER TABLE `quotes` ADD FULLTEXT INDEX `quotes_number_fulltext_idx` (`number`);
--> statement-breakpoint
ALTER TABLE `documents` ADD FULLTEXT INDEX `documents_number_fulltext_idx` (`number`);
