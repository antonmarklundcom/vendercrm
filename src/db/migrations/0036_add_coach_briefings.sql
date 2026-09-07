CREATE TABLE `coach_briefings` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`week_start` datetime NOT NULL,
	`metrics` json NOT NULL,
	`narrative` text NOT NULL,
	`recommendations` json NOT NULL,
	`source` varchar(10) NOT NULL,
	`ai_reply_id` char(26),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `coach_briefings_id` PRIMARY KEY(`id`),
	CONSTRAINT `coach_briefings_tenant_week_idx` UNIQUE(`tenant_id`,`week_start`)
);
--> statement-breakpoint
CREATE INDEX `coach_briefings_tenant_id_idx` ON `coach_briefings` (`tenant_id`);