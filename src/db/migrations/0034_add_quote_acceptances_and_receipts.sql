CREATE TABLE `quote_acceptances` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`quote_id` char(26) NOT NULL,
	`decision` varchar(10) NOT NULL,
	`name` varchar(200) NOT NULL,
	`comment` varchar(1000),
	`ip_address` varchar(45),
	`user_agent` varchar(500),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `quote_acceptances_id` PRIMARY KEY(`id`),
	CONSTRAINT `quote_acceptances_quote_id_idx` UNIQUE(`quote_id`)
);
--> statement-breakpoint
ALTER TABLE `document_payments` ADD `receipt_number` varchar(30);--> statement-breakpoint
ALTER TABLE `document_payments` ADD `receipt_public_token` varchar(64);--> statement-breakpoint
ALTER TABLE `document_payments` ADD CONSTRAINT `document_payments_receipt_token_idx` UNIQUE(`receipt_public_token`);--> statement-breakpoint
CREATE INDEX `quote_acceptances_tenant_id_idx` ON `quote_acceptances` (`tenant_id`);