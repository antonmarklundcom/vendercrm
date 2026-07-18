CREATE TABLE `activities` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`contact_id` char(26) NOT NULL,
	`deal_id` char(26),
	`type` enum('note','call','stage_change','form_submission','quote_sent','system') NOT NULL,
	`user_id` char(26),
	`payload` json,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contact_tags` (
	`tenant_id` char(26) NOT NULL,
	`contact_id` char(26) NOT NULL,
	`tag_id` char(26) NOT NULL,
	CONSTRAINT `contact_tags_contact_id_tag_id_pk` PRIMARY KEY(`contact_id`,`tag_id`)
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`name` varchar(255) NOT NULL,
	`phone` varchar(20) NOT NULL,
	`email` varchar(255),
	`notes` text,
	`source` varchar(100),
	`owner_user_id` char(26),
	`custom` json,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `contacts_id` PRIMARY KEY(`id`),
	CONSTRAINT `contacts_tenant_phone_idx` UNIQUE(`tenant_id`,`phone`)
);
--> statement-breakpoint
CREATE TABLE `deals` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`contact_id` char(26) NOT NULL,
	`pipeline_id` char(26) NOT NULL,
	`stage_id` char(26) NOT NULL,
	`title` varchar(255) NOT NULL,
	`value` bigint,
	`currency` char(3) NOT NULL DEFAULT 'PYG',
	`assigned_user_id` char(26),
	`position` int NOT NULL DEFAULT 0,
	`stage_entered_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`closed_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `deals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pipelines` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`name` varchar(100) NOT NULL,
	`position` int NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `pipelines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stages` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`pipeline_id` char(26) NOT NULL,
	`name` varchar(100) NOT NULL,
	`position` int NOT NULL DEFAULT 0,
	`color` varchar(20) NOT NULL DEFAULT '#6b7280',
	`is_won` boolean NOT NULL DEFAULT false,
	`is_lost` boolean NOT NULL DEFAULT false,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `stages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`name` varchar(100) NOT NULL,
	`color` varchar(20) NOT NULL DEFAULT '#6b7280',
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `tags_tenant_name_idx` UNIQUE(`tenant_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `form_submissions` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`form_id` char(26) NOT NULL,
	`contact_id` char(26) NOT NULL,
	`data` json NOT NULL,
	`ip_address` varchar(64),
	`user_agent` varchar(500),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `form_submissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `forms` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`fields` json NOT NULL DEFAULT ('[]'),
	`settings` json NOT NULL DEFAULT ('{}'),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `forms_id` PRIMARY KEY(`id`),
	CONSTRAINT `forms_tenant_slug_idx` UNIQUE(`tenant_id`,`slug`)
);
--> statement-breakpoint
ALTER TABLE `activities` ADD CONSTRAINT `activities_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activities` ADD CONSTRAINT `activities_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activities` ADD CONSTRAINT `activities_deal_id_deals_id_fk` FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activities` ADD CONSTRAINT `activities_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contact_tags` ADD CONSTRAINT `contact_tags_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contact_tags` ADD CONSTRAINT `contact_tags_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contact_tags` ADD CONSTRAINT `contact_tags_tag_id_tags_id_fk` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contacts` ADD CONSTRAINT `contacts_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contacts` ADD CONSTRAINT `contacts_owner_user_id_user_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `deals` ADD CONSTRAINT `deals_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `deals` ADD CONSTRAINT `deals_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `deals` ADD CONSTRAINT `deals_pipeline_id_pipelines_id_fk` FOREIGN KEY (`pipeline_id`) REFERENCES `pipelines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `deals` ADD CONSTRAINT `deals_stage_id_stages_id_fk` FOREIGN KEY (`stage_id`) REFERENCES `stages`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `deals` ADD CONSTRAINT `deals_assigned_user_id_user_id_fk` FOREIGN KEY (`assigned_user_id`) REFERENCES `user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pipelines` ADD CONSTRAINT `pipelines_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stages` ADD CONSTRAINT `stages_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stages` ADD CONSTRAINT `stages_pipeline_id_pipelines_id_fk` FOREIGN KEY (`pipeline_id`) REFERENCES `pipelines`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tags` ADD CONSTRAINT `tags_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `form_submissions` ADD CONSTRAINT `form_submissions_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `form_submissions` ADD CONSTRAINT `form_submissions_form_id_forms_id_fk` FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `form_submissions` ADD CONSTRAINT `form_submissions_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `forms` ADD CONSTRAINT `forms_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `activities_tenant_id_idx` ON `activities` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `activities_contact_id_idx` ON `activities` (`contact_id`);--> statement-breakpoint
CREATE INDEX `activities_deal_id_idx` ON `activities` (`deal_id`);--> statement-breakpoint
CREATE INDEX `contact_tags_tenant_id_idx` ON `contact_tags` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `contact_tags_tag_id_idx` ON `contact_tags` (`tag_id`);--> statement-breakpoint
CREATE INDEX `contacts_tenant_id_idx` ON `contacts` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `contacts_owner_user_id_idx` ON `contacts` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `deals_tenant_id_idx` ON `deals` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `deals_contact_id_idx` ON `deals` (`contact_id`);--> statement-breakpoint
CREATE INDEX `deals_stage_id_idx` ON `deals` (`stage_id`);--> statement-breakpoint
CREATE INDEX `deals_assigned_user_id_idx` ON `deals` (`assigned_user_id`);--> statement-breakpoint
CREATE INDEX `pipelines_tenant_id_idx` ON `pipelines` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `stages_tenant_id_idx` ON `stages` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `stages_pipeline_id_idx` ON `stages` (`pipeline_id`);--> statement-breakpoint
CREATE INDEX `tags_tenant_id_idx` ON `tags` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `form_submissions_tenant_id_idx` ON `form_submissions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `form_submissions_form_id_idx` ON `form_submissions` (`form_id`);--> statement-breakpoint
CREATE INDEX `form_submissions_contact_id_idx` ON `form_submissions` (`contact_id`);--> statement-breakpoint
CREATE INDEX `forms_tenant_id_idx` ON `forms` (`tenant_id`);