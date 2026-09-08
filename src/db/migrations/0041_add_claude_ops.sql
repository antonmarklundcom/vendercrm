CREATE TABLE `ops_batch_rows` (
	`id` char(26) NOT NULL,
	`batch_id` char(26) NOT NULL,
	`domain` varchar(255) NOT NULL,
	`display_name` varchar(200) NOT NULL,
	`tenant_mode` varchar(10) NOT NULL DEFAULT 'new',
	`tenant_id` char(26),
	`details` json NOT NULL DEFAULT ('{}'),
	`state` varchar(20) NOT NULL DEFAULT 'pending',
	`steps` json NOT NULL DEFAULT ('{}'),
	`last_error` json,
	`needs_input` text,
	`site_id` char(26),
	`pipeline_id` char(26),
	`api_key_id` char(26),
	`test_contact_id` char(26),
	`test_deal_id` char(26),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `ops_batch_rows_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ops_batches` (
	`id` char(26) NOT NULL,
	`token_id` char(26) NOT NULL,
	`title` varchar(200) NOT NULL,
	`raw_text` text,
	`status` varchar(20) NOT NULL DEFAULT 'open',
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `ops_batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ops_objects` (
	`id` char(26) NOT NULL,
	`token_id` char(26) NOT NULL,
	`batch_id` char(26),
	`row_id` char(26),
	`entity` varchar(20) NOT NULL,
	`entity_id` char(26) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `ops_objects_id` PRIMARY KEY(`id`),
	CONSTRAINT `ops_objects_entity_idx` UNIQUE(`entity`,`entity_id`)
);
--> statement-breakpoint
CREATE TABLE `ops_tokens` (
	`id` char(26) NOT NULL,
	`owner_user_id` char(26) NOT NULL,
	`label` varchar(100) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`token_prefix` varchar(16) NOT NULL,
	`allowed_tenant_ids` json NOT NULL DEFAULT ('[]'),
	`expires_at` datetime,
	`revoked_at` datetime,
	`last_used_at` datetime,
	`call_count` int NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `ops_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `ops_tokens_hash_idx` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE INDEX `ops_batch_rows_batch_idx` ON `ops_batch_rows` (`batch_id`);--> statement-breakpoint
CREATE INDEX `ops_batches_token_idx` ON `ops_batches` (`token_id`);--> statement-breakpoint
CREATE INDEX `ops_objects_token_idx` ON `ops_objects` (`token_id`);--> statement-breakpoint
CREATE INDEX `ops_objects_row_idx` ON `ops_objects` (`row_id`);--> statement-breakpoint
CREATE INDEX `ops_tokens_owner_idx` ON `ops_tokens` (`owner_user_id`);