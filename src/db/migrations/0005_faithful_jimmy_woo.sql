CREATE TABLE `flow_run_steps` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`run_id` char(26) NOT NULL,
	`node_id` varchar(64) NOT NULL,
	`status` varchar(16) NOT NULL,
	`result` json,
	`executed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `flow_run_steps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `flow_runs` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`flow_id` char(26) NOT NULL,
	`flow_version_id` char(26) NOT NULL,
	`contact_id` char(26) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'running',
	`current_node_id` varchar(64),
	`wait_until` datetime,
	`wait_for` varchar(16),
	`context` json,
	`started_by` json,
	`step_count` int NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `flow_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `flow_versions` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`flow_id` char(26) NOT NULL,
	`version` int NOT NULL,
	`graph` json NOT NULL,
	`published_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `flow_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `flow_versions_flow_version_uq` UNIQUE(`flow_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `flows` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`name` varchar(255) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'draft',
	`trigger_type` varchar(32) NOT NULL,
	`trigger_config` json,
	`stop_on_reply` boolean NOT NULL DEFAULT true,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `flows_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `flow_run_steps` ADD CONSTRAINT `flow_run_steps_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `flow_run_steps` ADD CONSTRAINT `flow_run_steps_run_id_flow_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `flow_runs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `flow_runs` ADD CONSTRAINT `flow_runs_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `flow_runs` ADD CONSTRAINT `flow_runs_flow_id_flows_id_fk` FOREIGN KEY (`flow_id`) REFERENCES `flows`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `flow_runs` ADD CONSTRAINT `flow_runs_flow_version_id_flow_versions_id_fk` FOREIGN KEY (`flow_version_id`) REFERENCES `flow_versions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `flow_runs` ADD CONSTRAINT `flow_runs_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `flow_versions` ADD CONSTRAINT `flow_versions_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `flow_versions` ADD CONSTRAINT `flow_versions_flow_id_flows_id_fk` FOREIGN KEY (`flow_id`) REFERENCES `flows`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `flows` ADD CONSTRAINT `flows_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `flow_run_steps_tenant_idx` ON `flow_run_steps` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `flow_run_steps_run_idx` ON `flow_run_steps` (`run_id`);--> statement-breakpoint
CREATE INDEX `flow_runs_tenant_idx` ON `flow_runs` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `flow_runs_flow_idx` ON `flow_runs` (`flow_id`);--> statement-breakpoint
CREATE INDEX `flow_runs_contact_idx` ON `flow_runs` (`contact_id`);--> statement-breakpoint
CREATE INDEX `flow_runs_flow_contact_idx` ON `flow_runs` (`flow_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `flow_runs_status_idx` ON `flow_runs` (`status`);--> statement-breakpoint
CREATE INDEX `flow_versions_tenant_idx` ON `flow_versions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `flow_versions_flow_idx` ON `flow_versions` (`flow_id`);--> statement-breakpoint
CREATE INDEX `flows_tenant_idx` ON `flows` (`tenant_id`);