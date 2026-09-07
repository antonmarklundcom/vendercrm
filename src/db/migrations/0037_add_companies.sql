CREATE TABLE `companies` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`name` varchar(200) NOT NULL,
	`ruc` varchar(30),
	`phone` varchar(20),
	`email` varchar(320),
	`address` varchar(500),
	`custom` json NOT NULL DEFAULT ('{}'),
	`notes` text,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `companies_id` PRIMARY KEY(`id`),
	CONSTRAINT `companies_tenant_name_idx` UNIQUE(`tenant_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `contacts` ADD `company_id` char(26);--> statement-breakpoint
CREATE INDEX `companies_tenant_id_idx` ON `companies` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `contacts_tenant_company_idx` ON `contacts` (`tenant_id`,`company_id`);