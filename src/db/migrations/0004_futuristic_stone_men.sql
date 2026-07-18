CREATE TABLE `products` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`unit_price` bigint NOT NULL,
	`currency` char(3) NOT NULL DEFAULT 'PYG',
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quote_items` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`quote_id` char(26) NOT NULL,
	`product_id` char(26),
	`description` varchar(500) NOT NULL,
	`qty` int NOT NULL DEFAULT 1,
	`unit_price` bigint NOT NULL,
	`line_total` bigint NOT NULL,
	`position` int NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `quote_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quote_sequences` (
	`tenant_id` char(26) NOT NULL,
	`next_number` int NOT NULL DEFAULT 1,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `quote_sequences_tenant_id` PRIMARY KEY(`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`contact_id` char(26) NOT NULL,
	`deal_id` char(26),
	`number` varchar(32) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'draft',
	`currency` char(3) NOT NULL DEFAULT 'PYG',
	`subtotal` bigint NOT NULL DEFAULT 0,
	`discount` bigint NOT NULL DEFAULT 0,
	`total` bigint NOT NULL DEFAULT 0,
	`valid_until` datetime,
	`notes` text,
	`public_token` varchar(64) NOT NULL,
	`pdf_storage_key` varchar(255),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `quotes_id` PRIMARY KEY(`id`),
	CONSTRAINT `quotes_tenant_number_uq` UNIQUE(`tenant_id`,`number`),
	CONSTRAINT `quotes_public_token_uq` UNIQUE(`public_token`)
);
--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quote_items` ADD CONSTRAINT `quote_items_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quote_items` ADD CONSTRAINT `quote_items_quote_id_quotes_id_fk` FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quote_items` ADD CONSTRAINT `quote_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quote_sequences` ADD CONSTRAINT `quote_sequences_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quotes` ADD CONSTRAINT `quotes_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quotes` ADD CONSTRAINT `quotes_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quotes` ADD CONSTRAINT `quotes_deal_id_deals_id_fk` FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `products_tenant_idx` ON `products` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `quote_items_tenant_idx` ON `quote_items` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `quote_items_quote_idx` ON `quote_items` (`quote_id`);--> statement-breakpoint
CREATE INDEX `quotes_tenant_idx` ON `quotes` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `quotes_contact_idx` ON `quotes` (`contact_id`);