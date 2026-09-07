ALTER TABLE `messages` ADD `media_mime_type` varchar(120);--> statement-breakpoint
ALTER TABLE `messages` ADD `transcript` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `transcript_status` varchar(10);--> statement-breakpoint
ALTER TABLE `messages` ADD `transcript_model` varchar(100);--> statement-breakpoint
ALTER TABLE `messages` ADD `transcript_at` datetime;--> statement-breakpoint
ALTER TABLE `messages` ADD `transcript_error` varchar(500);