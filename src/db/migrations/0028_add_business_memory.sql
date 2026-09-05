CREATE TABLE `business_facts` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`kind` varchar(10) NOT NULL,
	`title` varchar(300) NOT NULL,
	`body` text,
	`structured` json,
	`tags` json,
	`visibility` varchar(10) NOT NULL DEFAULT 'customer',
	`source` varchar(12) NOT NULL DEFAULT 'manual',
	`confirmed_at` datetime,
	`confirmed_by_user_id` char(26),
	`review_after` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `business_facts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `business_profiles` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`display_name` varchar(200),
	`legal_name` varchar(200),
	`ruc` varchar(30),
	`vertical_slug` varchar(60),
	`about` text,
	`tone` varchar(10),
	`tone_note` varchar(500),
	`audience` text,
	`differentiators` text,
	`languages` json,
	`website` varchar(500),
	`address` varchar(500),
	`maps_url` varchar(2000),
	`never_promise` text,
	`payment_methods` json,
	`completed_pct` int NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `business_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `business_profiles_tenant_id_idx` UNIQUE(`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `memory_imports` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`source_kind` varchar(5) NOT NULL,
	`source_ref` varchar(2000),
	`status` varchar(10) NOT NULL DEFAULT 'pending',
	`extracted_count` int NOT NULL DEFAULT 0,
	`ai_reply_id` char(26),
	`error` varchar(2000),
	`created_by` char(26),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `memory_imports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `setup_plans` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`status` varchar(10) NOT NULL DEFAULT 'draft',
	`brief` text,
	`preset` json,
	`outcome` json,
	`ai_reply_id` char(26),
	`created_by` char(26),
	`applied_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `setup_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `ai_replies` ADD `kind` varchar(20) DEFAULT 'reply' NOT NULL;--> statement-breakpoint
CREATE INDEX `business_facts_tenant_kind_idx` ON `business_facts` (`tenant_id`,`kind`);--> statement-breakpoint
CREATE INDEX `business_facts_tenant_visibility_idx` ON `business_facts` (`tenant_id`,`visibility`,`confirmed_at`);--> statement-breakpoint
CREATE INDEX `memory_imports_tenant_created_idx` ON `memory_imports` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `setup_plans_tenant_created_idx` ON `setup_plans` (`tenant_id`,`created_at`);--> statement-breakpoint
-- FULLTEXT retrieval without a vector database (PLAN.md §16.2 rule 4).
-- drizzle-kit's MySQL dialect cannot express a FULLTEXT index, so it is
-- created here by hand; modules/memory/retrieve.ts's MATCH … AGAINST needs
-- it and falls back to a LIKE scan without it.
CREATE FULLTEXT INDEX `business_facts_title_body_ft` ON `business_facts` (`title`, `body`);--> statement-breakpoint
-- Copy the five free-text AI fields into the memory (§16.3 "Migration").
-- The old `settings.ai` keys stay readable for one release — modules/ai
-- falls back to them for a tenant with no profile row — so this migration is
-- additive and reversible by dropping the tables.
--
-- IDs: the app writes ULIDs, which SQL cannot produce. A 26-char slice of an
-- uppercased UUID is unique and the same width; nothing sorts or parses these
-- ids, and every later row gets a real ULID from newId().
INSERT INTO `business_profiles`
  (`id`, `tenant_id`, `display_name`, `about`, `tone`, `tone_note`, `never_promise`, `completed_pct`)
SELECT
  SUBSTRING(UPPER(REPLACE(UUID(), '-', '')), 1, 26),
  `t`.`id`,
  NULLIF(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`t`.`settings`, '$.ai.businessName')), '')), ''),
  NULLIF(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`t`.`settings`, '$.ai.about')), '')), ''),
  CASE LOWER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`t`.`settings`, '$.ai.tone')), '')))
    WHEN 'cercano' THEN 'cercano'
    WHEN 'formal' THEN 'formal'
    WHEN 'directo' THEN 'directo'
    ELSE NULL
  END,
  NULLIF(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`t`.`settings`, '$.ai.tone')), '')), ''),
  NULLIF(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`t`.`settings`, '$.ai.neverPromise')), '')), ''),
  0
FROM `tenants` AS `t`
WHERE JSON_TYPE(JSON_EXTRACT(`t`.`settings`, '$.ai')) = 'OBJECT'
  AND NOT EXISTS (SELECT 1 FROM `business_profiles` `p` WHERE `p`.`tenant_id` = `t`.`id`);--> statement-breakpoint
-- The free-text `hours` string becomes a fact rather than a profile column:
-- the structured `settings.businessHours` is what the system reasons about,
-- and this is the sentence the business wants a customer to read. Confirmed
-- on arrival — an admin typed it (§16.2 rule 2 is about what the AI writes).
INSERT INTO `business_facts`
  (`id`, `tenant_id`, `kind`, `title`, `body`, `visibility`, `source`, `confirmed_at`)
SELECT
  SUBSTRING(UPPER(REPLACE(UUID(), '-', '')), 1, 26),
  `t`.`id`,
  'location',
  'Horario',
  TRIM(JSON_UNQUOTE(JSON_EXTRACT(`t`.`settings`, '$.ai.hours'))),
  'customer',
  'manual',
  CURRENT_TIMESTAMP
FROM `tenants` AS `t`
WHERE JSON_TYPE(JSON_EXTRACT(`t`.`settings`, '$.ai.hours')) = 'STRING'
  AND TRIM(JSON_UNQUOTE(JSON_EXTRACT(`t`.`settings`, '$.ai.hours'))) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM `business_facts` `f`
    WHERE `f`.`tenant_id` = `t`.`id` AND `f`.`kind` = 'location' AND `f`.`title` = 'Horario'
  );
