ALTER TABLE `lead_submissions` ADD `submitted_name` varchar(200);--> statement-breakpoint
ALTER TABLE `lead_submissions` ADD `submitted_email` varchar(320);--> statement-breakpoint
ALTER TABLE `lead_submissions` ADD `submitted_phone` varchar(30);--> statement-breakpoint
ALTER TABLE `lead_submissions` ADD `source` varchar(100);--> statement-breakpoint
ALTER TABLE `lead_submissions` ADD `needs_review` json;