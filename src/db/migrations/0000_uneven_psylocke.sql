CREATE TABLE `jobs` (
	`id` char(26) NOT NULL,
	`type` varchar(100) NOT NULL,
	`payload` json NOT NULL,
	`tenant_id` char(26),
	`run_at` datetime NOT NULL,
	`status` enum('pending','running','done','failed','dead') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`max_attempts` int NOT NULL DEFAULT 5,
	`locked_at` datetime,
	`locked_by` varchar(64),
	`last_error` varchar(2000),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `jobs_status_run_at_idx` ON `jobs` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `jobs_tenant_id_idx` ON `jobs` (`tenant_id`);