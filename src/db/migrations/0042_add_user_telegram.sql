ALTER TABLE `users` ADD `telegram_chat_id` varchar(32);--> statement-breakpoint
ALTER TABLE `users` ADD `telegram_link_token` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `telegram_link_expires_at` datetime;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_telegram_link_token_idx` UNIQUE(`telegram_link_token`);