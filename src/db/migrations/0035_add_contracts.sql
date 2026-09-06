CREATE TABLE `contract_acceptances` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`contract_id` char(26) NOT NULL,
	`name_typed` varchar(200) NOT NULL,
	`decision` varchar(20) NOT NULL,
	`ip_address` varchar(45),
	`user_agent` varchar(500),
	`pdf_sha256` varchar(64) NOT NULL,
	`signature_storage_key` varchar(500),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `contract_acceptances_id` PRIMARY KEY(`id`),
	CONSTRAINT `contract_acceptances_contract_id_idx` UNIQUE(`contract_id`)
);
--> statement-breakpoint
CREATE TABLE `contract_templates` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`name` varchar(200) NOT NULL,
	`body` text NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `contract_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`template_id` char(26) NOT NULL,
	`template_snapshot` text NOT NULL,
	`contact_id` char(26) NOT NULL,
	`deal_id` char(26),
	`quote_id` char(26),
	`number` varchar(30) NOT NULL,
	`rendered_body` text NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'draft',
	`public_token` varchar(64) NOT NULL,
	`pdf_storage_key` varchar(500),
	`signed_pdf_storage_key` varchar(500),
	`sent_at` datetime,
	`decided_at` datetime,
	`voided_at` datetime,
	`void_reason` varchar(500),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `contracts_id` PRIMARY KEY(`id`),
	CONSTRAINT `contracts_tenant_number_idx` UNIQUE(`tenant_id`,`number`),
	CONSTRAINT `contracts_public_token_idx` UNIQUE(`public_token`)
);
--> statement-breakpoint
CREATE INDEX `contract_acceptances_tenant_id_idx` ON `contract_acceptances` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `contract_templates_tenant_id_idx` ON `contract_templates` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `contract_templates_tenant_active_idx` ON `contract_templates` (`tenant_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `contracts_tenant_id_idx` ON `contracts` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `contracts_tenant_contact_idx` ON `contracts` (`tenant_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `contracts_tenant_status_idx` ON `contracts` (`tenant_id`,`status`);